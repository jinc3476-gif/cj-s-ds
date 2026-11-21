import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useTheme } from './theme.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { ReleaseHistoryButton } from '../components/updates/ReleaseHistory.js'
import styles from './App.module.css'

export const App = () => {
  const [showSplash, setShowSplash] = useState(true)
  const theme = useTheme()
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const mainRef = useRef<HTMLElement>(null)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const activeProjectId = useChatStore((state) => state.activeProjectId)
  const pageKey = activeId ? `${session ? 'chat' : 'loading'}:${activeId}` : `home:${activeProjectId ?? ''}`

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1050)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider mainRef={mainRef} /> : siderCollapsed ? null : <Sider />}
        <main ref={mainRef} className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {!isMobile && <div className={styles.updates}><ReleaseHistoryButton /></div>}
            {siderCollapsed ? <CollapsedSider /> : null}
            <div key={pageKey} className={`${styles.routeTransition} quovia-page-enter`} data-home={!activeId && !activeProjectId ? '' : undefined}>
              {!ready || (activeId !== null && !session) ? (
                <div className={styles.loadingView}>
                  {isMobile ? <MobileHeader /> : null}
                  <div className={styles.loadingState} role="status" aria-live="polite">
                    <span>
                      {(!ready ? initError : sessionLoadError)
                        ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                        : t('sessionLoading')}
                    </span>
                    {(!ready ? initError : sessionLoadError) ? (
                      <Button
                        variant="outlined"
                        size="m"
                        onClick={() => {
                          if (!ready) {
                            void initChat()
                          } else if (activeId !== null) {
                            selectSession(activeId)
                          }
                        }}
                      >
                        {t('retry')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : session ? (
                <SessionView
                  session={session}
                  streaming={streaming}
                  siderCollapsed={siderCollapsed}
                />
              ) : (
                <Welcome />
              )}
            </div>
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <Toast />
      {showSplash && (
        <div className={styles.splash} data-theme={theme} aria-hidden="true">
          <svg viewBox="0 0 108 108" focusable="false">
            <path
              fill="url(#quovia-splash-a)"
              d="M26 72c-.5-16 2.8-27.4 12.4-35.8C46.2 29.4 55.4 27 67.2 27h12.3c2.1 0 3.3 2.3 2.1 4.1L64.8 58.6c-2.8 4.3-7.5 6.8-12.6 6.8H36.6c-3.6 0-5.7 1.4-7.4 4.6L26 76.7z"
            />
            <path
              fill="url(#quovia-splash-b)"
              d="M82 35v20.5C82 75 69.4 91 50.2 91H28.3c-2.1 0-3.3-2.3-2.1-4.1l18.5-27.5c2.8-4.2 7.5-6.8 12.6-6.8H73c3.6 0 5.7-1.4 7.4-4.6z"
            />
            <defs>
              <linearGradient id="quovia-splash-a" x1="27" x2="82" y1="72" y2="28">
                <stop stopColor="#2c5bea" />
                <stop offset=".58" stopColor="#6c62e8" />
                <stop offset="1" stopColor="#b66de5" />
              </linearGradient>
              <linearGradient id="quovia-splash-b" x1="27" x2="82" y1="88" y2="38">
                <stop stopColor="#ae68ca" />
                <stop offset=".42" stopColor="#f18493" />
                <stop offset=".72" stopColor="#f6c45f" />
                <stop offset="1" stopColor="#55bdb2" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}
    </>
  )
}
