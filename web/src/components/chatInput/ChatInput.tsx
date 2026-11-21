import clsx from 'clsx'
import { memo, useCallback, useEffect, useRef } from 'react'
import {
  IconGlobeLanguageOutline14,
  IconMicOutline16,
  IconCloseOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { projectDraftKey, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { useVoicePress } from './useVoicePress.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  const projectId = useChatStore(state => state.activeProjectId)
  const draftId = sessionId ?? projectDraftKey(projectId)
  return <Input key={draftId ?? 'new'} draftId={draftId} sessionId={sessionId} />
})

const Input = ({ sessionId, draftId }: { sessionId: string | null; draftId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(draftId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(draftId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const holding = useRef(false)

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(draftId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(draftId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [draftId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(draftId, id)
      }
    },
    [draftId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(draftId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  const recording = voice.status === 'recording'
  const voiceBusy = voice.status !== 'idle'
  const press = useVoicePress(
    () => {
      holding.current = true
      textareaRef.current?.blur()
      void voice.start()
    },
    () => void voice.finish(),
    voice.cancel
  )
  const micLabel =
    voice.status === 'starting'
      ? t('voiceInputCancelStart')
      : recording
        ? t('voiceInputStop')
        : voice.status === 'transcribing'
          ? t('voiceInputCancel')
          : t('voiceInput')
  const voiceHint =
    voice.status === 'starting'
      ? t('voiceInputStarting')
      : recording
        ? t(holding.current ? 'voiceInputHoldHint' : 'voiceInputTapHint')
        : voice.status === 'transcribing'
          ? t('voiceInputTranscribing')
          : ''
  const hasDraft = Boolean(text.trim() || attachments.length)

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(draftId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, voiceBusy && styles.voiceBusy)}
          placeholder={t('chatInputPlaceholderChat')}
          aria-label={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          readOnly={voiceBusy}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPointerDown={(event) => press.begin(event, !voiceBusy && !text && !importingHistory)}
          onPointerUp={press.onPointerUp}
          onPointerCancel={press.onPointerCancel}
          onLostPointerCapture={press.onLostPointerCapture}
          onContextMenu={(event) => {
            if (!text && holding.current && voiceBusy) {
              event.preventDefault()
            }
          }}
          onClick={(event) => {
            if (press.consumeClick()) {
              event.preventDefault()
            }
          }}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        <div className={styles.voiceStatus} role="status">
          {voiceBusy && (
            <>
              <span>{voiceHint}</span>
              {recording && (
                <time aria-hidden="true">
                  {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
                </time>
              )}
            </>
          )}
        </div>
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          <Tooltip content={t('uploadFile')}>
            <button
              type="button"
              className={styles.roundButton}
              aria-label={t('uploadFile')}
              disabled={importingHistory || voiceBusy}
              onClick={() => ensureApiKey() && fileInputRef.current?.click()}
            >
              <span className={styles.plus} aria-hidden="true" />
            </button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <Tooltip content={micLabel}>
            <button
              type="button"
              className={clsx(styles.roundButton, voiceBusy && styles.activeMic)}
              aria-label={micLabel}
              data-no-sider-swipe=""
              disabled={importingHistory}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => press.begin(event, !voiceBusy)}
              onPointerUp={press.onPointerUp}
              onPointerCancel={press.onPointerCancel}
              onLostPointerCapture={press.onLostPointerCapture}
              onClick={(event) => {
                if (event.detail && press.consumeClick()) {
                  return
                }
                if (recording) {
                  void voice.finish()
                } else if (voiceBusy) {
                  voice.cancel()
                } else {
                  holding.current = false
                  void voice.start()
                }
              }}
            >
              {recording ? (
                <IconStopFill16 />
              ) : voiceBusy ? (
                <IconCloseOutline16 />
              ) : (
                <IconMicOutline16 />
              )}
            </button>
          </Tooltip>
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : hasDraft && !voiceBusy ? (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          ) : null}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
