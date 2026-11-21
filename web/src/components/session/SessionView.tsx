import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  copySessionFullText,
  exportSessionMarkdown,
} from '../../services/chat/exportMarkdown.js'
import type { Session } from '../../services/chat/types.js'
import { useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEllipsisOutline16,
} from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { ModelSwitcher } from './ModelSwitcher.js'
import { SessionStatsBar } from './SessionStatsBar.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 模型切换 + 导出操作 + 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const project = useChatStore((s) => s.projects.find((p) => p.id === session.projectId))
  const title = [project?.name, session.title || t('untitledChat')].filter(Boolean).join(' / ')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} sessionId={session.id} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.headerLeft, siderCollapsed && styles.withCollapsedSider)}>
            <ModelSwitcher />
            <div className={styles.title}>{title}</div>
          </div>
          <div className={styles.headerActions}>
            <Menu
              options={[
                {
                  key: 'copy-full',
                  label: t('copyFullChat'),
                  icon: <IconCopyOutline16 />,
                  onSelect: () => void copySessionFullText(session),
                },
                {
                  key: 'export-md',
                  label: t('exportMarkdown'),
                  icon: <IconDownloadOutline16 />,
                  onSelect: () => void exportSessionMarkdown(session),
                },
              ]}
            >
              {({ toggle }) => (
                <IconButton
                  size="m"
                  icon={<IconEllipsisOutline16 />}
                  tooltip={t('chatActions')}
                  tooltipPlacement="bottom"
                  onClick={toggle}
                />
              )}
            </Menu>
          </div>
        </div>
      )}
      <SessionStatsBar session={session} />
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
