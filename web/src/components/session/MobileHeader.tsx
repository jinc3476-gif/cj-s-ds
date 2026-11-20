import {
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEllipsisOutline16,
  IconMenuOutline20,
  IconNewChatOutline20,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import {
  copySessionFullText,
  exportSessionMarkdown,
} from '../../services/chat/exportMarkdown.js'
import { newChatIn, useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { ModelSwitcher } from './ModelSwitcher.js'
import styles from './MobileHeader.module.css'
import { ReleaseHistoryButton } from '../updates/ReleaseHistory.js'

/** 移动端顶栏：左侧菜单打开侧边栏；支持模型切换；会话页再显示标题、对话导出与开启新对话 */
export const MobileHeader = ({ title, sessionId }: { title?: string; sessionId?: string }) => {
  const t = useTranslate()
  const projectId = useChatStore((s) => s.activeProjectId)
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div className={styles.title}>
        {title ?? <span className="quovia-wordmark">{t('appName')}</span>}
      </div>
      <div className={styles.actions}>
        <ModelSwitcher compact />
        {sessionId ? (
          <Menu
            options={[
              {
                key: 'copy-full',
                label: t('copyFullChat'),
                icon: <IconCopyOutline16 />,
                onSelect: () => void copySessionFullText(sessionId),
              },
              {
                key: 'export-md',
                label: t('exportMarkdown'),
                icon: <IconDownloadOutline16 />,
                onSelect: () => void exportSessionMarkdown(sessionId),
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton
                size="m"
                tone="primary"
                icon={<IconEllipsisOutline16 />}
                aria-label={t('chatActions')}
                onClick={toggle}
              />
            )}
          </Menu>
        ) : null}
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
    </div>
  )
}
