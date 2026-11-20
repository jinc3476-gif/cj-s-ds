import { useSyncExternalStore } from 'react'
import { chatFontPixels, useSettings, type ThemePreference } from '../services/settings.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const THEME_BG: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#19191b',
}

const syncPageBackground = (fallbackTheme?: Theme) => {
  const computed = getComputedStyle(document.body).backgroundColor
  const backgroundColor =
    computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent'
      ? computed
      : THEME_BG[fallbackTheme ?? appliedTheme ?? 'light']
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 同步页面主题、根画布背景、支持 theme-color 的浏览器栏以及 Android 系统栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  document.documentElement.style.backgroundColor = THEME_BG[theme]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme])
  if (document.readyState === 'complete') {
    syncPageBackground(theme)
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedTheme: Theme | null = null
let syncedPreference: ThemePreference | null = null

const syncTheme = () => {
  const preference = useSettings.getState().themePreference
  const theme = resolveTheme(preference, getOsTheme())
  const themeChanged = theme !== appliedTheme
  const prefChanged = preference !== syncedPreference
  if (themeChanged) {
    appliedTheme = theme
    applyTheme(theme)
  }
  if (themeChanged || prefChanged) {
    syncedPreference = preference
    window.AndroidBridge?.syncTheme?.(preference, theme === 'dark')
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  const syncFontSize = () => {
    const pixels = chatFontPixels[useSettings.getState().chatFontSize]
    document.body.style.setProperty('--chat-font-size', `${pixels}px`)
  }
  syncFontSize()
  useSettings.subscribe((state, last) => {
    if (state.chatFontSize !== last.chatFontSize) {
      syncFontSize()
    }
  })
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => syncPageBackground(), { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}
