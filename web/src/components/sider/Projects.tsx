import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { newChatIn, removeProject, saveProject, useChatStore } from '../../services/chat/store.js'
import type { Project, SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconEditOutline16, IconTrashOutline16, NewChatIcon } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { SessionItem } from './SessionItem.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './Projects.module.css'

export const Projects = ({ onDelete }: { onDelete: (session: SessionSummary) => void }) => {
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
    <section className={styles.projects} aria-label={t('projects')}>
      <button
        className={styles.create}
        disabled={!ready || importingHistory}
        onClick={() => edit({})}
      >
        <NewChatIcon />
        {t('createProject')}
      </button>
      {projects.map((p) => (
        <details key={p.id} className={styles.project} open={p.id === activeProjectId}>
          <summary title={p.name}>{p.name}</summary>
          <IconButton
            className={styles.edit}
            icon={<IconEditOutline16 />}
            tooltip={t('editProject')}
            onClick={() => edit(p)}
          />
          <IconButton
            className={styles.delete}
            icon={<IconTrashOutline16 />}
            tooltip={t('deleteProject')}
            onClick={() => {
              setDeleteError(false)
              setDeleting(p)
            }}
          />
          <div className={styles.controls}>
            <button
              onClick={() => {
                newChatIn(p.id)
                closeMobileSider()
              }}
            >
              {t('newProjectChat')}
            </button>
          </div>
          {sessions
            .filter((s) => s.projectId === p.id)
            .map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={activeId === s.id}
                onDelete={() => onDelete(s)}
              />
            ))}
        </details>
      ))}
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
