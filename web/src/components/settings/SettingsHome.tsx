import type { ReactNode } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { getRegionName, provinces } from '../../services/location.js'
import { useSettings, type ChatFontSize } from '../../services/settings.js'
import {
  IconChevronRightOutline14,
  IconDataOutline16,
  IconGlobeLanguageOutline14,
  IconLightOutline16,
  IconPlayMediaOutline16,
} from '../base/icons.js'
import { openSettings, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

export const pageTitles = {
  general: 'settings',
  account: 'settingsAccount',
  data: 'settingDialogAsideDataOptionLabel',
  language: 'settingsLocalePreference',
  appearance: 'settingsAppearance',
  font: 'settingsFont',
  personalization: 'settingsPersonalization',
  location: 'settingsLocation',
  voice: 'settingsTtsVoice',
  privacy: 'settingsPrivacy',
  version: 'settingsVersion',
} satisfies Record<SettingsSection, TranslationKey>

export const fontLabels = {
  small: 'settingsFontSmall',
  standard: 'settingsFontStandard',
  large: 'settingsFontLarge',
} satisfies Record<ChatFontSize, TranslationKey>

const lineIcon = (drawing: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {drawing}
  </svg>
)
const info = lineIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5m0-9v.1" />
  </>
)
const rowIcons = {
  account: lineIcon(
    <>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M3.8 21a8.3 8.3 0 0 1 16.4 0" />
    </>
  ),
  data: <IconDataOutline16 />,
  language: <IconGlobeLanguageOutline14 />,
  appearance: <IconLightOutline16 />,
  font: <span>A</span>,
  personalization: lineIcon(
    <>
      <path d="m10 2 2.1 6.3L18.5 11l-6.4 2.5L10 20l-2.4-6.5L1.5 11l6.1-2.7L10 2Zm9 13 1 2.7 2.5.8-2.5 1-1 2.5-.8-2.5-2.7-1 2.7-.8L19 15Z" />
    </>
  ),
  location: <IconGlobeLanguageOutline14 />,
  voice: <IconPlayMediaOutline16 />,
  privacy: info,
  version: info,
}
type Detail = keyof typeof rowIcons
const groups: { title: TranslationKey; pages: Detail[] }[] = [
  { title: 'settingsGroupAccount', pages: ['account', 'data'] },
  {
    title: 'settingsGroupApp',
    pages: ['language', 'appearance', 'font', 'personalization', 'location'],
  },
  { title: 'settingsGroupVoice', pages: ['voice'] },
  { title: 'settingsGroupAbout', pages: ['privacy', 'version'] },
]

export const SettingsHome = () => {
  const t = useTranslate()
  const { apiKey, locale, themePreference, chatFontSize, ttsVoice, location } = useSettings()
  const province = location?.province
    ? provinces.find((item) => item.code === location.province)
    : null
  const city = province?.cities.find((item) => item.code === location?.city)
  const status: Partial<Record<Detail, string>> = {
    account: t(apiKey ? 'settingsConfigured' : 'settingsNotConfigured'),
    language: t(locale === 'zh-CN' ? 'settingsLocaleZhCN' : 'settingsLocaleEnUS'),
    appearance: t(
      {
        system: 'avatarMenuSettingsDialogThemeSelectSystemOption',
        light: 'avatarMenuSettingsDialogThemeSelectLightOption',
        dark: 'avatarMenuSettingsDialogThemeSelectDarkOption',
      }[themePreference] as TranslationKey
    ),
    font: t(fontLabels[chatFontSize]),
    location:
      city?.name ||
      province?.name ||
      (location ? getRegionName(location.region, locale) : t('settingsUnset')),
    voice: t(ttsVoice === 'stella' ? 'settingsTtsVoiceStella' : 'settingsTtsVoiceTide'),
    version: window.AndroidBridge?.getAppVersion?.() || __APP_VERSION__,
  }
  return groups.map((group) => (
    <section key={group.title} className={styles.group}>
      <h2>{t(group.title)}</h2>
      <div className={styles.list}>
        {group.pages.map((page) => (
          <button
            key={page}
            type="button"
            className={styles.listRow}
            data-setting={page}
            onClick={() => openSettings(page)}
          >
            <span aria-hidden="true" className={styles.rowIcon}>
              {rowIcons[page]}
            </span>
            <span>{t(pageTitles[page])}</span>
            <span className={styles.rowValue}>{status[page]}</span>
            <span aria-hidden="true" className={styles.chevron}>
              <IconChevronRightOutline14 />
            </span>
          </button>
        ))}
      </div>
    </section>
  ))
}
