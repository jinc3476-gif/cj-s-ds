import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import {
  copySessionFullText,
  exportSessionMarkdown,
} from '../../services/chat/exportMarkdown.js'
import {
  moveSessionToProject,
  renameSession,
  selectSession,
  togglePinSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

const PinIcon = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
)

const FolderIcon = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  onMoveProject,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  onMoveProject?: (session: SessionSummary) => void
}) {
  const t = useTranslate()
  const hasProjects = useChatStore((state) => state.projects.length > 0)
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  const options: MenuOption[] = [
    {
      key: 'pin',
      label: t(session.pinned ? 'unpinSession' : 'pinSession'),
      icon: <PinIcon />,
      onSelect: () => togglePinSession(session.id),
    },
    ...(hasProjects && onMoveProject
      ? [
          {
            key: 'move-project',
            label: t('moveToProject'),
            icon: <FolderIcon />,
            onSelect: () => onMoveProject(session),
          },
        ]
      : []),
    ...(session.projectId
      ? [
          {
            key: 'remove-project',
            label: t('removeFromProject'),
            icon: <FolderIcon />,
            onSelect: () => {
              if (moveSessionToProject(session.id, null)) {
                showToast({ key: 'sessionRemovedFromProject' })
              }
            },
          },
        ]
      : []),
    {
      key: 'copy-full',
      label: t('copyFullChat'),
      icon: <IconCopyOutline16 />,
      onSelect: () => void copySessionFullText(session.id),
    },
    {
      key: 'export-md',
      label: t('exportMarkdown'),
      icon: <IconDownloadOutline16 />,
      onSelect: () => void exportSessionMarkdown(session.id),
    },
    {
      key: 'rename',
      label: t('sessionItemMenuRenameOption'),
      icon: <IconEditOutline16 />,
      onSelect: () => setEditing(true),
    },
    {
      key: 'delete',
      label: t('delete'),
      icon: <IconTrashOutline16 />,
      danger: true,
      onSelect: onDelete,
    },
  ]

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      {session.pinned ? (
        <span className={styles.pinBadge} aria-hidden="true">
          <PinIcon />
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu options={options}>
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
