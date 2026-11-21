import clsx from 'clsx'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { ApiError, fetchUserBalance } from '../../services/api/client.js'
import { useBalanceStore } from '../../services/balance.js'
import { classifyApiError } from '../../services/api/errors.js'
import type { UserBalanceResponse } from '../../services/api/types.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  hasPersonalizationContent,
  isChineseBrowser,
  resetPersonalization,
  setLocale,
  setChatFontSize,
  setLocation,
  setPersonalization,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
  type ChatFontSize,
  type ReplyLanguagePreference,
  type ReplyStylePreset,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, openSettings, useSettingsDialog } from './settingsDialogState.js'
import { fontLabels, pageTitles, SettingsHome } from './SettingsHome.js'
import styles from './Settings.module.css'

export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const section = useSettingsDialog((state) => state.section)
  const homeRef = useRef<HTMLDivElement>(null)
  const previousPage = useRef(section)
  useLayoutEffect(() => {
    if (section === 'general' && previousPage.current !== 'general') {
      homeRef.current
        ?.querySelector<HTMLElement>(`[data-setting="${previousPage.current}"]`)
        ?.focus()
    }
    previousPage.current = section
  }, [section])
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t(pageTitles[section])}
        backLabel={t(section === 'general' ? 'close' : 'settingsBack')}
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            if (section === 'general') {
              closeSettings()
            } else if (section === 'theme') {
              openSettings('personalization')
            } else {
              openSettings('general')
            }
          }
        }}
      >
        <div ref={homeRef} className={clsx(styles.content, 'quovia-page-enter')} hidden={section !== 'general'}>
          <SettingsHome />
        </div>
        {section === 'general' ? null : (
          <div className={clsx(styles.content, 'quovia-page-enter')} key={section}>
            {section === 'theme' ? null : section === 'personalization' ? (
              <PersonalizationSetting />
            ) : (
              <div className={styles.detail}>
                {section === 'account' && (
                  <>
                    <ApiKeyField editor={apiKeyEditor} />
                    {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
                    <AccountBalance />
                    <section className={styles.platform}>
                      <h2>{t('platformTitle')}</h2>
                      <div className={styles.platformRow}>
                        <a href="https://platform.deepseek.com/sign_in" target="_blank" rel="noreferrer">{t('platformLogin')}</a>
                        <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">{t('platformKeys')}</a>
                        <a href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer">{t('platformBalance')}</a>
                      </div>
                      <p>{t('platformHelp')}</p>
                    </section>
                    <div className={styles.description}>{t('apiProviderNote')}</div>
                  </>
                )}
                {section === 'appearance' && <ThemeSetting />}
                {section === 'version' && <AppUpdateSetting />}
                {section === 'language' && <LocaleSetting />}
                {section === 'font' && <ChatFontSetting />}
                {section === 'voice' && <TtsVoiceSetting />}
                {section === 'location' && <LocationSetting />}
                {section === 'data' && (
                  <>
                    <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                    <ExportHistory disabled={historyBusy} />
                    <SettingCell
                      label={t('deleteAllSessions')}
                      status={null}
                      action={
                        <Button
                          variant="dangerOutlined"
                          size="m"
                          className={styles.cellButton}
                          disabled={historyBusy}
                          onClick={historyDelete.open}
                        >
                          {t('delete')}
                        </Button>
                      }
                    />
                  </>
                )}
                {section === 'privacy' && (
                  <div className={styles.privacy}>
                    <p>{t('apiProviderNote')}</p>
                    <p>{t('settingsPrivacyChat')}</p>
                    <p>{t('settingsPrivacyVoice')}</p>
                    <h2>{t('openSourceNotice')}</h2>
                    <p>{t('openSourceDescription', { version: __APP_VERSION__ })}</p>
                    <a href="/LICENSE" target="_blank" rel="noreferrer">
                      MIT License
                    </a>
                    {' · '}
                    <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
                      Third-party notices
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

const styleOptions: { value: ReplyStylePreset; label: TranslationKey }[] = [
  { value: 'default', label: 'personalizationStyleDefault' },
  { value: 'concise', label: 'personalizationStyleConcise' },
  { value: 'detailed', label: 'personalizationStyleDetailed' },
  { value: 'professional', label: 'personalizationStyleProfessional' },
  { value: 'casual', label: 'personalizationStyleCasual' },
]

const replyLanguageOptions: { value: ReplyLanguagePreference; label: TranslationKey }[] = [
  { value: 'auto', label: 'personalizationLanguageAuto' },
  { value: 'zh-CN', label: 'personalizationLanguageZhCN' },
  { value: 'zh-TW', label: 'personalizationLanguageZhTW' },
  { value: 'en', label: 'personalizationLanguageEn' },
  { value: 'ja', label: 'personalizationLanguageJa' },
]

/** 个性化设置：全局自定义指令（称呼/背景/回复风格/语言偏好/附加要求）+ 底部「主题」占位入口 */
const PersonalizationSetting = () => {
  const t = useTranslate()
  const personalization = useSettings((state) => state.personalization)
  const hasContent = hasPersonalizationContent(personalization)
  return (
    <div className={styles.personalizationWrap}>
      <div className={styles.detail}>
        <div className={clsx(styles.cell, styles.row)}>
          <div className={styles.text}>
            <div className={styles.label}>{t('personalizationEnable')}</div>
            <div className={styles.description}>{t('personalizationEnableDesc')}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={personalization.enabled}
            aria-label={t('personalizationEnable')}
            className={clsx(styles.switch, personalization.enabled && styles.switchChecked)}
            onClick={() => setPersonalization({ enabled: !personalization.enabled })}
          >
            <span className={styles.switchThumb} />
          </button>
        </div>

        <div className={clsx(styles.personalizationForm, !personalization.enabled && styles.personalizationMuted)}>
          <label className={styles.field}>
            <span className={styles.label}>{t('personalizationNickname')}</span>
            <input
              type="text"
              maxLength={60}
              className={styles.textInput}
              value={personalization.nickname}
              placeholder={t('personalizationNicknamePlaceholder')}
              onChange={(event) => setPersonalization({ nickname: event.target.value })}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('personalizationBackground')}</span>
            <textarea
              rows={3}
              maxLength={1500}
              className={styles.textareaInput}
              value={personalization.background}
              placeholder={t('personalizationBackgroundPlaceholder')}
              onChange={(event) => setPersonalization({ background: event.target.value })}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>{t('personalizationStyle')}</span>
            <div
              role="radiogroup"
              aria-label={t('personalizationStyle')}
              className={styles.chipGroup}
            >
              {styleOptions.map((option) => {
                const selected = personalization.stylePreset === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={clsx(styles.chip, selected && styles.chipSelected)}
                    onClick={() => setPersonalization({ stylePreset: option.value })}
                  >
                    {t(option.label)}
                  </button>
                )
              })}
            </div>
          </div>

          <SettingCell
            label={t('personalizationLanguage')}
            status={null}
            className={styles.inlineSelectCell}
            action={
              <Select
                ariaLabel={t('personalizationLanguage')}
                value={personalization.languagePreference}
                options={replyLanguageOptions.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                }))}
                onChange={(languagePreference) => setPersonalization({ languagePreference })}
              />
            }
          />

          <label className={styles.field}>
            <span className={styles.label}>{t('personalizationCustom')}</span>
            <textarea
              rows={4}
              maxLength={1500}
              className={styles.textareaInput}
              value={personalization.customInstructions}
              placeholder={t('personalizationCustomPlaceholder')}
              onChange={(event) => setPersonalization({ customInstructions: event.target.value })}
            />
          </label>

          {hasContent ? (
            <div className={styles.personalizationFooter}>
              <Button variant="outlined" size="s" onClick={resetPersonalization}>
                {t('personalizationReset')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.list}>
        <button
          type="button"
          className={styles.listRow}
          data-setting="theme"
          onClick={() => openSettings('theme')}
        >
          <span aria-hidden="true" className={styles.rowIcon}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
              <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
              <circle cx="8.5" cy="7.5" r="1" fill="currentColor" />
              <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z" />
            </svg>
          </span>
          <span>{t('settingsThemeEntry')}</span>
          <span className={styles.rowValue}>{t('settingsThemeComingSoon')}</span>
          <span aria-hidden="true" className={styles.chevron}>
            <IconChevronRightOutline14 />
          </span>
        </button>
      </div>
    </div>
  )
}

const currencySymbol = (currency: string) =>
  currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `

/** DeepSeek API 账户余额查询（点击触发 GET /user/balance） */
const AccountBalance = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState<UserBalanceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = async () => {
    if (!apiKey || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await fetchUserBalance(apiKey)
      setBalance(next)
      useBalanceStore.setState({ apiKey, data: next, loading: false, updatedAt: Date.now() })
    } catch (cause) {
      const kind = classifyApiError(cause)
      if (kind === 'unauthorized') {
        setError(t('apiKeyInvalid'))
      } else if (kind === 'network') {
        setError(t('commonNetworkErrorToast'))
      } else {
        const message =
          cause instanceof ApiError && cause.localMessage
            ? t(cause.localMessage.key, cause.localMessage.params)
            : cause instanceof Error
              ? cause.message
              : String(cause)
        setError(t('balanceQueryFailed', { message }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.balanceSection}>
      <div className={styles.balanceHeader}>
        <span className={styles.label}>{t('balanceTitle')}</span>
        <Button
          variant="outlined"
          size="s"
          disabled={!apiKey || busy}
          onClick={() => void query()}
        >
          {busy ? t('balanceChecking') : balance ? t('balanceRefresh') : t('balanceCheck')}
        </Button>
      </div>
      {!apiKey ? <div className={styles.description}>{t('balanceNeedKey')}</div> : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {balance ? (
        <div className={styles.balanceBody}>
          {!balance.is_available ? (
            <div className={styles.error}>{t('balanceUnavailable')}</div>
          ) : null}
          {balance.balance_infos.length === 0 ? (
            <div className={styles.description}>{t('balanceEmpty')}</div>
          ) : (
            balance.balance_infos.map((info) => {
              const sym = currencySymbol(info.currency)
              return (
                <div key={info.currency} className={styles.balanceRow}>
                  <span className={styles.balanceTotal}>
                    {sym}
                    {info.total_balance}
                  </span>
                  <span className={styles.balanceSub}>
                    {t('balanceToppedUp', { amount: `${sym}${info.topped_up_balance}` })}
                    {' · '}
                    {t('balanceGranted', { amount: `${sym}${info.granted_balance}` })}
                  </span>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </section>
  )
}

const AppUpdateSetting = () => {
  const t = useTranslate()
  const bridge = window.AndroidBridge
  const supported = typeof bridge?.checkForUpdate === 'function'
  const configured = bridge?.isUpdateConfigured?.() ?? false
  const version = bridge?.getAppVersion?.() ?? __APP_VERSION__
  return (
    <SettingCell
      label={t('appUpdate')}
      description={t(
        supported
          ? configured
            ? 'appUpdateReady'
            : 'appUpdateUnavailable'
          : 'appUpdateAndroidOnly',
        { version }
      )}
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={!supported || !configured}
          onClick={() => bridge?.checkForUpdate?.()}
        >
          {t('checkForUpdate')}
        </Button>
      }
    />
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

const ChatFontSetting = () => {
  const t = useTranslate()
  const value = useSettings((state) => state.chatFontSize)
  return (
    <SettingCell
      label={t('settingsChatFont')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsChatFont')}
          value={value}
          onChange={setChatFontSize}
          options={(Object.keys(fontLabels) as ChatFontSize[]).map((size) => ({
            value: size,
            label: t(fontLabels[size]),
          }))}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0 && state.projects.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      if (window.AndroidBridge) {
        const reader = new FileReader()
        reader.onload = () =>
          window.AndroidBridge?.saveDownload(name, String(reader.result).split(',')[1] ?? '')
        reader.readAsDataURL(blob)
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
