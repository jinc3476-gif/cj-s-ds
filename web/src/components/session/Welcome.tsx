import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import { ModelSwitcher } from './ModelSwitcher.js'
import styles from './Welcome.module.css'

/** 新对话：顶栏模型切换 + 问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const projectName = useChatStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name)
  return (
    <div className={styles.container}>
      {isMobile ? (
        <MobileHeader title={projectName} />
      ) : (
        <div className={styles.desktopHeader}>
          <ModelSwitcher className={clsx(siderCollapsed && styles.withCollapsedSider)} />
        </div>
      )}
      <div className={styles.welcome}>
        <h1 className={styles.greeting}>{projectName || t('welcomeMessageChat250808')}</h1>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
