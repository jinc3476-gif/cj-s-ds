import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { newChatIn, removeProject, saveProject, useChatStore } from '../../services/chat/store.js'
import type { Project, SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconEditOutline16,
  IconEllipsisOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { SessionItem } from './SessionItem.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './Projects.module.css'

const PlusIcon = () => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
  >
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </svg>
)

const MenuPlusIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </svg>
)

const FolderClosedIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

const FolderOpenIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </svg>
)

const ChevronRightSmallIcon = () => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
)

export const Projects = ({
  onDelete,
  onMoveProject,
}: {
  onDelete: (session: SessionSummary) => void
  onMoveProject?: (session: SessionSummary) => void
}) => {
  const t = useTranslate()
  const { projects, sessions, activeId, activeProjectId, ready, importingHistory } = useChatStore(
    (s) => ({
      projects: s.projects,
      sessions: s.sessions,
      activeId: s.activeId,
      activeProjectId: s.activeProjectId,
      ready: s.ready,
      importingHistory: s.importingHistory,
    })
  )
  const [editing, setEditing] = useState<Partial<Project> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [deleteError, setDeleteError] = useState(false)
  const edit = (p: Partial<Project>) => {
    setError(false)
    setEditing(p)
  }
  const submit = async () => {
    if (!editing?.name?.trim() || busy) {
      return
    }
    setBusy(true)
    try {
      if (!(await saveProject(editing.id, editing.name, editing.memory ?? ''))) {
        throw new Error()
      }
      setEditing(null)
      if (!editing.id) {
        closeMobileSider()
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className={clsx(styles.projects, projects.length > 0 && styles.hasProjects)}
      aria-label={t('projects')}
    >
      <div className={styles.header}>
        <span className={styles.heading}>{t('projects')}</span>
        <button
          type="button"
          className={styles.create}
          aria-label={t('createProject')}
          title={t('createProject')}
          disabled={!ready || importingHistory}
          onClick={() => edit({})}
        >
          <PlusIcon />
          <span>{t('createProjectShort')}</span>
        </button>
      </div>
      {projects.length > 0 ? (
        <div className={styles.projectList}>
          {projects.map((p) => {
            const projectSessions = sessions.filter((s) => s.projectId === p.id)
            const isActiveProject = p.id === activeProjectId
            const projectOptions: MenuOption[] = [
              {
                key: 'new-chat',
                label: t('newProjectChat'),
                icon: <MenuPlusIcon />,
                onSelect: () => {
                  newChatIn(p.id)
                  closeMobileSider()
                },
              },
              {
                key: 'edit',
                label: t('editProject'),
                icon: <IconEditOutline16 />,
                onSelect: () => edit(p),
              },
              {
                key: 'delete',
                label: t('deleteProject'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: () => {
                  setDeleteError(false)
                  setDeleting(p)
                },
              },
            ]
            return (
              <details
                key={p.id}
                className={clsx(styles.project, isActiveProject && styles.projectActive)}
                open={isActiveProject}
              >
                <summary className={styles.summary}>
                  <span className={styles.folderIcon} aria-hidden="true">
                    <span className={styles.folderClosed}>
                      <FolderClosedIcon />
                    </span>
                    <span className={styles.folderOpen}>
                      <FolderOpenIcon />
                    </span>
                  </span>
                  <span className={styles.titleGroup}>
                    <span className={styles.projectName} title={p.name}>
                      {p.name}
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      <ChevronRightSmallIcon />
                    </span>
                  </span>
                  <div className={styles.actions}>
                    {projectSessions.length > 0 ? (
                      <span className={styles.count} aria-hidden="true">
                        {projectSessions.length}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={styles.newChatBtn}
                      aria-label={t('newProjectChat')}
                      title={t('newProjectChat')}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        newChatIn(p.id)
                        closeMobileSider()
                      }}
                    >
                      <PlusIcon />
                      <span>{t('newProjectChatShort')}</span>
                    </button>
                    <div
                      className={styles.menuWrap}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                    >
                      <Menu options={projectOptions}>
                        {({ toggle }) => (
                          <IconButton
                            icon={<IconEllipsisOutline16 />}
                            aria-label={t('projectActions')}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              toggle()
                            }}
                          />
                        )}
                      </Menu>
                    </div>
                  </div>
                </summary>
                <div className={styles.children}>
                  {projectSessions.length > 0 ? (
                    projectSessions.map((s) => (
                      <SessionItem
                        key={s.id}
                        session={s}
                        active={activeId === s.id}
                        nested
                        onDelete={() => onDelete(s)}
                        onMoveProject={onMoveProject}
                      />
                    ))
                  ) : (
                    <div className={styles.empty}>{t('projectEmptyChats')}</div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      ) : null}
      {deleting && (
        <Modal
          title={t('deleteProjectTitle')}
          onClose={() => {
            if (!busy) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={busy} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setDeleteError(false)
                  try {
                    if (await removeProject(deleting.id)) {
                      setDeleting(null)
                    } else {
                      setDeleteError(true)
                    }
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteProjectDescription', {
            name: deleting.name,
            count: sessions.filter((session) => session.projectId === deleting.id).length,
          })}
          {deleteError && <div role="alert">{t('projectDeleteError')}</div>}
        </Modal>
      )}
      {editing && (
        <Modal
          title={t(editing.id ? 'editProject' : 'createProject')}
          onClose={() => {
            if (!busy) {
              setEditing(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={busy} onClick={() => setEditing(null)}>
                {t('cancel')}
              </Button>
              <Button disabled={!editing.name?.trim() || busy} onClick={() => void submit()}>
                {t('confirm')}
              </Button>
            </>
          }
        >
          <div className={styles.fields}>
            <label>
              {t('projectName')}
              <input
                autoFocus
                maxLength={80}
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label>
              {t('projectMemory')}
              <textarea
                rows={4}
                maxLength={4000}
                value={editing.memory ?? ''}
                onChange={(e) => setEditing({ ...editing, memory: e.target.value })}
              />
            </label>
            {error && <span role="alert">{t('projectSaveError')}</span>}
          </div>
        </Modal>
      )}
    </section>
  )
}
