import { goBackFromModal } from '../components/base/Modal.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'

window.handleAndroidBack = () => {
  if (goBackFromModal()) {
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
