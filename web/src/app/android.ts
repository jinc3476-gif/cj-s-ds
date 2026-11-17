import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'

window.handleAndroidBack = () => {
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  if (useSearchPanel.getState().entry !== null) {
    closeSearchPanel()
    return true
  }
  return false
}
