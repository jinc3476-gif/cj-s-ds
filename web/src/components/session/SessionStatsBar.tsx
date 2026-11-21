import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { getModelContextWindow } from '../../services/api/types.js'
import {
  formatCurrencySymbol,
  pickPrimaryBalance,
  refreshBalance,
  useBalanceStore,
} from '../../services/balance.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { AssistantMessage, Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconRefreshOutline16 } from '../base/icons.js'
import { formatModelShortName } from './ModelSwitcher.js'
import styles from './SessionStatsBar.module.css'

const GaugeIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 14l4-4" />
    <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </svg>
)

const DatabaseIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </svg>
)

const WalletIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M3 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3" />
    <circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

const ContextRing = ({ percent, tone }: { percent: number; tone: 'normal' | 'warn' | 'danger' }) => {
  const radius = 5.8
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, percent))
  const visualPercent = clamped > 0 ? Math.max(clamped, 3) : 0
  const dashOffset = circumference * (1 - visualPercent / 100)
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      className={clsx(styles.ring, tone !== 'normal' && styles[tone])}
      aria-hidden="true"
    >
      <circle className={styles.ringTrack} cx="8" cy="8" r={radius} fill="none" strokeWidth="2.1" />
      {visualPercent > 0 ? (
        <circle
          className={styles.ringValue}
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 8 8)"
        />
      ) : null}
    </svg>
  )
}

const formatCompactTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    const val = tokens / 1_000_000
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, '')}M`
  }
  if (tokens >= 1_000) {
    const val = tokens / 1_000
    return `${val >= 100 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')}K`
  }
  return tokens.toLocaleString()
}

const formatContextPercent = (percent: number): string => {
  if (percent <= 0) {
    return '0%'
  }
  if (percent < 0.1) {
    return '<0.1%'
  }
  if (percent < 10) {
    return `${percent.toFixed(1)}%`
  }
  return `${Math.round(percent)}%`
}

/**
 * 对话顶部纤细状态条（参考 DSH 设计）：一眼呈现生成速率、缓存命中率、上下文占用与账户余额，
 * 点击可展开完整 Token 与余额明细浮层。
 */
export const SessionStatsBar = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const activeModel = useSettings((s) => s.model)
  const apiKey = useSettings((s) => s.apiKey)
  const balance = useBalanceStore((s) => s.data)
  const balanceLoading = useBalanceStore((s) => s.loading)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (apiKey) {
      void refreshBalance()
    }
  }, [apiKey, session.id])

  const stats = useMemo(() => {
    const path = getVisibleMessages(session)
    let latest: AssistantMessage | undefined
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const msg = path[i]
      if (msg.role === 'assistant' && msg.usage) {
        latest = msg
        break
      }
    }
    if (!latest?.usage) {
      return null
    }
    const { usage } = latest
    const totalInput =
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    const totalContext = totalInput + usage.output_tokens
    const model = latest.model ?? activeModel
    const contextWindow = getModelContextWindow(model)
    const contextPercent = contextWindow > 0 ? (totalContext / contextWindow) * 100 : 0
    const cacheHitPercent =
      totalInput > 0 ? Math.round((usage.cache_read_input_tokens / totalInput) * 100) : 0
    const speed =
      latest.generationMs && latest.generationMs > 0 && usage.output_tokens > 0
        ? Math.max(1, Math.round(usage.output_tokens / (latest.generationMs / 1000)))
        : null
    const tone: 'normal' | 'warn' | 'danger' =
      contextPercent >= 85 ? 'danger' : contextPercent >= 65 ? 'warn' : 'normal'
    return {
      model,
      usage,
      totalInput,
      totalContext,
      contextWindow,
      contextPercent,
      cacheHitPercent,
      speed,
      tone,
    }
  }, [session, activeModel])

  const primaryBalance = useMemo(() => pickPrimaryBalance(balance), [balance])
  const balanceAmount = primaryBalance ? Number(primaryBalance.total_balance) : null
  const balanceTone: 'normal' | 'warn' | 'danger' = !balance
    ? 'normal'
    : !balance.is_available || (balanceAmount !== null && balanceAmount <= 0)
      ? 'danger'
      : balanceAmount !== null && balanceAmount <= 1
        ? 'warn'
        : 'normal'

  const hasContent = Boolean(stats) || Boolean(primaryBalance)

  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open && hasContent, { align: 'center', offset: 6 })
  useDismiss(open && hasContent, [anchorRef, floatingRef], () => setOpen(false))

  if (!hasContent) {
    return null
  }

  const contextPercentText = stats ? formatContextPercent(stats.contextPercent) : ''
  const limitText = stats ? formatCompactTokens(stats.contextWindow) : ''

  return (
    <div className={styles.barWrap}>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.bar, open && styles.open)}
        aria-label={t('sessionStatsLabel')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {stats?.speed !== null && stats?.speed !== undefined ? (
          <span className={styles.metric}>
            <span className={styles.icon} aria-hidden="true">
              <GaugeIcon />
            </span>
            <span>{t('sessionStatsSpeed', { speed: stats.speed })}</span>
          </span>
        ) : null}
        {stats ? (
          <>
            <span className={styles.metric}>
              <span className={styles.icon} aria-hidden="true">
                <DatabaseIcon />
              </span>
              <span>{t('sessionStatsCacheHit', { percent: stats.cacheHitPercent })}</span>
            </span>
            <span className={clsx(styles.metric, stats.tone !== 'normal' && styles[stats.tone])}>
              <ContextRing percent={stats.contextPercent} tone={stats.tone} />
              <span>{contextPercentText}</span>
            </span>
          </>
        ) : null}
        {primaryBalance ? (
          <span className={clsx(styles.metric, balanceTone !== 'normal' && styles[balanceTone])}>
            <span className={styles.icon} aria-hidden="true">
              <WalletIcon />
            </span>
            <span>
              {formatCurrencySymbol(primaryBalance.currency)}
              {primaryBalance.total_balance}
            </span>
          </span>
        ) : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.popover}
              style={position ?? undefined}
              role="dialog"
              aria-label={t('sessionStatsDetailTitle')}
              data-no-sider-swipe=""
            >
              <div className={styles.popoverTitle}>{t('sessionStatsDetailTitle')}</div>
              {stats ? (
                <>
                  <div className={styles.contextBlock}>
                    <div className={styles.row}>
                      <span className={styles.label}>{t('sessionStatsDetailContext')}</span>
                      <span
                        className={clsx(
                          styles.value,
                          stats.tone !== 'normal' && styles[stats.tone]
                        )}
                      >
                        {formatCompactTokens(stats.totalContext)} / {limitText} (
                        {contextPercentText})
                      </span>
                    </div>
                    <div className={styles.progressTrack} aria-hidden="true">
                      <div
                        className={clsx(
                          styles.progressFill,
                          stats.tone !== 'normal' && styles[stats.tone]
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(stats.totalContext > 0 ? 1.5 : 0, stats.contextPercent))}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.label}>{t('sessionStatsDetailCache')}</span>
                    <span className={styles.value}>{stats.cacheHitPercent}%</span>
                  </div>
                  <div className={styles.subRow}>
                    {t('sessionStatsDetailCacheBreakdown', {
                      read: stats.usage.cache_read_input_tokens.toLocaleString(),
                      create: stats.usage.cache_creation_input_tokens.toLocaleString(),
                      uncached: stats.usage.input_tokens.toLocaleString(),
                    })}
                  </div>
                  <div className={styles.row}>
                    <span className={styles.label}>{t('sessionStatsDetailOutput')}</span>
                    <span className={styles.value}>
                      {stats.usage.output_tokens.toLocaleString()} tokens
                    </span>
                  </div>
                  {stats.speed !== null ? (
                    <div className={styles.row}>
                      <span className={styles.label}>{t('sessionStatsDetailSpeed')}</span>
                      <span className={styles.value}>
                        {t('sessionStatsSpeed', { speed: stats.speed })}
                      </span>
                    </div>
                  ) : null}
                  <div className={styles.row}>
                    <span className={styles.label}>{t('sessionStatsDetailModel')}</span>
                    <span className={styles.value}>
                      {formatModelShortName(stats.model, t)} ·{' '}
                      {t('sessionStatsDetailWindow', { limit: limitText })}
                    </span>
                  </div>
                </>
              ) : null}
              {apiKey ? (
                <div className={clsx(styles.balanceSection, stats && styles.balanceDivider)}>
                  <div className={styles.row}>
                    <span className={styles.label}>{t('balanceTitle')}</span>
                    <span className={styles.balanceRight}>
                      {primaryBalance ? (
                        <span
                          className={clsx(
                            styles.value,
                            balanceTone !== 'normal' && styles[balanceTone]
                          )}
                        >
                          {formatCurrencySymbol(primaryBalance.currency)}
                          {primaryBalance.total_balance}
                        </span>
                      ) : (
                        <span className={styles.muted}>
                          {balanceLoading ? t('balanceChecking') : t('balanceEmpty')}
                        </span>
                      )}
                      <button
                        type="button"
                        className={clsx(styles.refreshBtn, balanceLoading && styles.spinning)}
                        aria-label={t('balanceRefresh')}
                        title={t('balanceRefresh')}
                        disabled={balanceLoading}
                        onClick={() => void refreshBalance(true)}
                      >
                        <IconRefreshOutline16 />
                      </button>
                    </span>
                  </div>
                  {balance?.balance_infos.map((info) => {
                    const sym = formatCurrencySymbol(info.currency)
                    return (
                      <div key={info.currency} className={styles.subRow}>
                        {balance.balance_infos.length > 1 ? `${sym}${info.total_balance} · ` : ''}
                        {t('balanceToppedUp', { amount: `${sym}${info.topped_up_balance}` })}
                        {' · '}
                        {t('balanceGranted', { amount: `${sym}${info.granted_balance}` })}
                      </div>
                    )
                  })}
                  {balance && !balance.is_available ? (
                    <div className={clsx(styles.subRow, styles.danger)}>
                      {t('balanceUnavailable')}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
