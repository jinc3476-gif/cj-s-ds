import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { translate, useTranslate } from '../../i18n/index.js'
import { fetchAvailableModels } from '../../services/api/client.js'
import { BUILTIN_MODELS, type ChatModel } from '../../services/api/types.js'
import { setAvailableModels, setModel, useSettings } from '../../services/settings.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconRefreshOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './ModelSwitcher.module.css'

type Translator = typeof translate

export const formatModelShortName = (model: ChatModel, t: Translator): string => {
  if (model === 'deepseek-flash') {
    return t('modelFlashShort')
  }
  if (model === 'deepseek-v4-pro') {
    return t('modelProShort')
  }
  return model.replace(/^deepseek-/i, '')
}

const formatModelDisplayName = (model: ChatModel, t: Translator): string => {
  if (model === 'deepseek-flash') {
    return t('modelFlashName')
  }
  if (model === 'deepseek-v4-pro') {
    return t('modelProName')
  }
  return model
}

const formatModelDesc = (model: ChatModel, t: Translator): string => {
  if (model === 'deepseek-flash') {
    return t('modelFlashDesc')
  }
  if (model === 'deepseek-v4-pro') {
    return t('modelProDesc')
  }
  return t('modelCustomDesc')
}

const isNonChatModel = (id: string) => /tts|asr|whisper|speech|embed/i.test(id)

/** 顶栏模型切换器：内置 deepseek-flash / deepseek-v4-pro，并支持按 /models 动态校验与合并可用列表 */
export const ModelSwitcher = ({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const apiKey = useSettings((state) => state.apiKey)
  const availableModels = useSettings((state) => state.availableModels)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: compact ? 'end' : 'start', offset: 6 })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))

  const verifiedSet = useMemo(() => new Set(availableModels), [availableModels])

  const options = useMemo(() => {
    const ids = new Set<string>(BUILTIN_MODELS)
    for (const id of availableModels) {
      if (!isNonChatModel(id)) {
        ids.add(id)
      }
    }
    if (model) {
      ids.add(model)
    }
    return [...ids] as ChatModel[]
  }, [availableModels, model])

  const refreshModels = async () => {
    if (!apiKey || refreshing) {
      return
    }
    setRefreshing(true)
    try {
      const models = await fetchAvailableModels(apiKey)
      setAvailableModels(models)
    } catch {
      showToast({ key: 'modelRefreshFailed', type: 'error' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, compact && styles.compact, open && styles.open, className)}
        aria-label={t('modelSelectorLabel')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerText}>
          {compact ? formatModelShortName(model, t) : formatModelDisplayName(model, t)}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.popover}
              style={position ?? undefined}
              role="listbox"
              aria-label={t('modelSelectorLabel')}
            >
              <div className={styles.popoverHeader}>
                <span>{t('modelSelectorLabel')}</span>
                {apiKey ? (
                  <button
                    type="button"
                    className={clsx(styles.refreshButton, refreshing && styles.spinning)}
                    aria-label={t('modelRefresh')}
                    title={t('modelRefresh')}
                    disabled={refreshing}
                    onClick={() => void refreshModels()}
                  >
                    <IconRefreshOutline16 />
                  </button>
                ) : null}
              </div>
              {refreshing ? <div className={styles.refreshing}>{t('modelRefreshing')}</div> : null}
              <div className={styles.list}>
                {options.map((id) => {
                  const selected = id === model
                  const hasVerifiedList = availableModels.length > 0
                  const verified = verifiedSet.has(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={clsx(styles.option, selected && styles.optionSelected)}
                      onClick={() => {
                        setModel(id)
                        setOpen(false)
                      }}
                    >
                      <div className={styles.optionMain}>
                        <div className={styles.optionTop}>
                          <span className={styles.optionName}>{formatModelDisplayName(id, t)}</span>
                          {hasVerifiedList ? (
                            <span
                              className={clsx(
                                styles.badge,
                                verified ? styles.badgeVerified : styles.badgeUnlisted
                              )}
                            >
                              {t(verified ? 'modelVerified' : 'modelUnlisted')}
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.optionDesc}>{formatModelDesc(id, t)}</div>
                      </div>
                      <span className={styles.check} aria-hidden="true">
                        {selected ? <IconCheckOutline16 /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
