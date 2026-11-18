import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const projectName = useChatStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name)
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader title={projectName} /> : null}
      <div className={styles.welcome}>
        <h1 className={styles.greeting}>{projectName || t('welcomeMessageChat250808')}</h1>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
