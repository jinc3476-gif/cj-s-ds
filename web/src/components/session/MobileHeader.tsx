import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChatIn, useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'
import { ReleaseHistoryButton } from '../updates/ReleaseHistory.js'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题与开启新对话 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const projectId = useChatStore(s => s.activeProjectId)
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div className={styles.title}>{title ?? <span className="quovia-wordmark">{t('appName')}</span>}</div>
      {title !== undefined ? (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t(projectId ? 'newProjectChat' : 'newChat')}
          onClick={() => newChatIn(projectId)}
        />
      ) : null}
      <ReleaseHistoryButton />
    </div>
  )
}
