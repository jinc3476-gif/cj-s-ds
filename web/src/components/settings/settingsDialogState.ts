import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

export type SettingsSection =
  | 'general'
  | 'account'
  | 'data'
  | 'language'
  | 'appearance'
  | 'font'
  | 'personalization'
  | 'theme'
  | 'location'
  | 'voice'
  | 'privacy'
  | 'version'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 请求需要 API Key 的操作时直接进入账号管理。 */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('account')
  return false
}
