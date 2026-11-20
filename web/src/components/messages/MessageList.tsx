import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import {
  clearJumpTarget,
  selectMessageVersion,
  useChatStore,
} from '../../services/chat/store.js'
import type { Message, Session } from '../../services/chat/types.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import styles from './MessageList.module.css'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 距底部超过该值时展示「回到底部」悬浮按钮 */
const JUMP_BUTTON_THRESHOLD = 120
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
const SEARCH_HIGHLIGHT_NAME = 'quovia-search-hit'

/** 使用 CSS Custom Highlight API 高亮目标消息内匹配的关键词，不破坏 React DOM 树。 */
const applyTextHighlight = (root: HTMLElement, query: string): (() => void) => {
  const needle = query.trim().toLowerCase()
  const cssWithHighlights = CSS as unknown as {
    highlights?: Map<string, unknown>
  }
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
    .Highlight
  if (!needle || !cssWithHighlights.highlights || !HighlightCtor) {
    return () => {}
  }
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    let from = 0
    while (from < lower.length && ranges.length < 32) {
      const idx = lower.indexOf(needle, from)
      if (idx === -1) {
        break
      }
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + needle.length)
      ranges.push(range)
      from = idx + needle.length
    }
  }
  if (ranges.length === 0) {
    return () => {}
  }
  cssWithHighlights.highlights.set(SEARCH_HIGHLIGHT_NAME, new HighlightCtor(...ranges))
  return () => {
    cssWithHighlights.highlights?.delete(SEARCH_HIGHLIGHT_NAME)
  }
}

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const jumpTarget = useChatStore((state) => state.jumpTarget)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const updateScrollButton = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollButton(distance > JUMP_BUTTON_THRESHOLD)
  }, [])
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
      setShowScrollButton(false)
    }
  }, [])
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    stickyRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowScrollButton(false)
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(() => {
      if (stickyRef.current) {
        scrollToBottom()
      } else {
        updateScrollButton()
      }
    })
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom, updateScrollButton])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      updateScrollButton()
      return
    }
    const currentJump = useChatStore.getState().jumpTarget
    if (currentJump && currentJump.sessionId === session.id) {
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom, updateScrollButton])

  // 搜索正文跳转：滚动到命中消息并高亮提示。
  useEffect(() => {
    if (!jumpTarget || jumpTarget.sessionId !== session.id) {
      return
    }
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }
    const targetEl = scroll.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(jumpTarget.messageId)}"]`
    )
    if (!targetEl) {
      clearJumpTarget()
      return
    }
    stickyRef.current = false
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(jumpTarget.messageId)
    const clearTextHighlight = applyTextHighlight(targetEl, jumpTarget.query)
    clearJumpTarget()
    const timer = window.setTimeout(() => {
      setHighlightedId((current) => (current === jumpTarget.messageId ? null : current))
      clearTextHighlight()
    }, 2800)
    return () => {
      window.clearTimeout(timer)
      clearTextHighlight()
    }
  }, [jumpTarget, session.id, messages.length])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
      updateScrollButton()
    }
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const nearBottom = distance < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      setShowScrollButton(distance > JUMP_BUTTON_THRESHOLD)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom, updateScrollButton])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {messages.map((message, index) => (
              <div
                key={message.id}
                data-message-id={message.id}
                className={clsx(
                  styles.messageItem,
                  highlightedId === message.id && styles.messageHighlighted
                )}
              >
                {message.role === 'user' ? (
                  <UserMessage
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.footerSlot}>
          {showScrollButton ? (
            <button
              type="button"
              className={styles.scrollToBottomButton}
              aria-label={t('scrollToBottom')}
              title={t('scrollToBottom')}
              onClick={jumpToBottom}
            >
              <IconChevronDownOutline14 />
            </button>
          ) : null}
          {footer}
        </div>
      </div>
    </ScrollToBottomContext.Provider>
  )
}
