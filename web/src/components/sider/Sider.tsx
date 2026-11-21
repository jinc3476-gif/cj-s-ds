import clsx from 'clsx'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconCloseFill14,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { searchSessionsContent, type ContentSearchHit } from '../../services/chat/db.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  jumpToMessage,
  moveSessionToProject,
  newChat,
  removeSession,
  selectSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { Projects } from './Projects.js'
import { useMobileSiderSwipe } from './useMobileSiderSwipe.js'
import styles from './Sider.module.css'

const SearchIcon = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

/** 在文本中高亮所有大小写不敏感匹配的子串 */
const highlightMatch = (text: string, query: string): ReactNode => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return text
  }
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let key = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor)
    if (idx === -1) {
      parts.push(text.slice(cursor))
      break
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx))
    }
    parts.push(
      <mark key={key++} className={styles.mark}>
        {text.slice(idx, idx + needle.length)}
      </mark>
    )
    cursor = idx + needle.length
  }
  return parts.length === 1 ? parts[0] : parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)
}

/** 展开的侧边栏：名称与收起按钮、开启新对话、搜索栏、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const projects = useChatStore((state) => state.projects)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(
    () => groupSessions(sessions.filter((s) => !s.projectId), now, t),
    [sessions, now, t]
  )
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [moving, setMoving] = useState<SessionSummary | null>(null)
  const [query, setQuery] = useState('')
  const [contentHits, setContentHits] = useState<ContentSearchHit[]>([])
  const [searchingContent, setSearchingContent] = useState(false)

  const trimmedQuery = query.trim()

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  )

  // 按标题 / 项目名即时过滤
  const metaMatchIds = useMemo(() => {
    const needle = trimmedQuery.toLowerCase()
    if (!needle) {
      return new Set<string>()
    }
    const matched = new Set<string>()
    for (const session of sessions) {
      const title = (session.title || t('untitledChat')).toLowerCase()
      const projectName = session.projectId ? (projectById.get(session.projectId) ?? '').toLowerCase() : ''
      if (title.includes(needle) || (projectName && projectName.includes(needle))) {
        matched.add(session.id)
      }
    }
    return matched
  }, [trimmedQuery, sessions, projectById, t])

  // 防抖检索 IndexedDB 历史正文
  useEffect(() => {
    if (!trimmedQuery) {
      setContentHits([])
      setSearchingContent(false)
      return
    }
    const signal = { cancelled: false }
    setSearchingContent(true)
    const timer = window.setTimeout(() => {
      void searchSessionsContent(trimmedQuery, useChatStore.getState().sessionCache, signal)
        .then((hits) => {
          if (!signal.cancelled) {
            setContentHits(hits)
            setSearchingContent(false)
          }
        })
        .catch(() => {
          if (!signal.cancelled) {
            setContentHits([])
            setSearchingContent(false)
          }
        })
    }, 180)
    return () => {
      signal.cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmedQuery, sessions])

  const searchResults = useMemo(() => {
    if (!trimmedQuery) {
      return []
    }
    const hitBySession = new Map(contentHits.map((hit) => [hit.sessionId, hit]))
    const items: {
      session: SessionSummary
      projectName?: string
      metaMatched: boolean
      hit?: ContentSearchHit
    }[] = []
    for (const session of sessions) {
      const metaMatched = metaMatchIds.has(session.id)
      const hit = hitBySession.get(session.id)
      if (!metaMatched && !hit) {
        continue
      }
      items.push({
        session,
        projectName: session.projectId ? projectById.get(session.projectId) : undefined,
        metaMatched,
        hit,
      })
    }
    return items.sort(
      (a, b) =>
        Number(b.metaMatched) - Number(a.metaMatched) ||
        Number(Boolean(b.session.pinned)) - Number(Boolean(a.session.pinned)) ||
        b.session.updatedAt - a.session.updatedAt
    )
  }, [trimmedQuery, sessions, metaMatchIds, contentHits, projectById])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}><span className="quovia-wordmark">{t('appName')}</span></div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.searchBox}>
        <span className={styles.searchIcon} aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          aria-label={t('searchChats')}
          placeholder={t('searchChatsPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={t('searchChatsClear')}
            onClick={() => setQuery('')}
          >
            <IconCloseFill14 />
          </button>
        ) : null}
      </div>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {trimmedQuery ? (
            <div className={styles.searchResults}>
              {searchResults.map(({ session, projectName, hit }) => {
                const title = session.title || t('untitledChat')
                const active = session.id === activeId
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={clsx(styles.searchResultItem, active && styles.searchResultActive)}
                    onClick={() => {
                      if (hit) {
                        jumpToMessage(session.id, hit.messageId, trimmedQuery)
                      } else {
                        selectSession(session.id)
                      }
                      closeMobileSider()
                    }}
                  >
                    <div className={styles.searchResultTop}>
                      <span className={styles.searchResultTitle}>
                        {highlightMatch(title, trimmedQuery)}
                      </span>
                      {projectName ? (
                        <span className={styles.searchResultProject}>
                          {highlightMatch(projectName, trimmedQuery)}
                        </span>
                      ) : null}
                    </div>
                    {hit ? (
                      <div className={styles.searchResultSnippet}>
                        {highlightMatch(hit.snippet, trimmedQuery)}
                      </div>
                    ) : null}
                  </button>
                )
              })}
              {searchingContent ? (
                <div className={styles.searchStatus}>{t('searchChatsSearching')}</div>
              ) : searchResults.length === 0 ? (
                <div className={styles.searchStatus}>{t('searchChatsEmpty')}</div>
              ) : null}
            </div>
          ) : (
            <>
              <Projects onDelete={setDeleting} onMoveProject={setMoving} />
              {groups.map((group) => (
                <div key={group.key} className={styles.section}>
                  <div className={styles.sectionHeader}>{group.label}</div>
                  {group.sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeId}
                      onDelete={() => setDeleting(session)}
                      onMoveProject={setMoving}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.settings}
          onClick={() => {
            if (mobile) {
              closeMobileSider()
            }
            openSettings('general')
          }}
        >
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {moving ? (
        <Modal
          title={t('moveToProjectTitle')}
          onClose={() => setMoving(null)}
          footer={
            <Button variant="outlined" onClick={() => setMoving(null)}>
              {t('cancel')}
            </Button>
          }
        >
          <div className={styles.projectPicker}>
            {moving.projectId ? (
              <button
                type="button"
                className={styles.projectPickerOption}
                onClick={() => {
                  if (moveSessionToProject(moving.id, null)) {
                    showToast({ key: 'sessionRemovedFromProject' })
                  }
                  setMoving(null)
                }}
              >
                <span>{t('moveToProjectNone')}</span>
              </button>
            ) : null}
            {projects.map((project) => {
              const current = moving.projectId === project.id
              return (
                <button
                  key={project.id}
                  type="button"
                  className={clsx(
                    styles.projectPickerOption,
                    current && styles.projectPickerSelected
                  )}
                  onClick={() => {
                    if (!current && moveSessionToProject(moving.id, project.id)) {
                      showToast({ key: 'sessionMovedToProject', params: { name: project.name } })
                    }
                    setMoving(null)
                  }}
                >
                  <span className={styles.projectPickerName}>{project.name}</span>
                  {current ? (
                    <span className={styles.projectPickerCheck} aria-hidden="true">
                      <IconCheckOutline16 />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端推拉式抽屉：参考 DeepSeek 手机端联动效果，支持全屏右滑唤出、左滑关闭及点空白区域关闭。 */
export const MobileSider = ({ mainRef }: { mainRef: RefObject<HTMLElement | null> }) => {
  const open = useMobileSider((state) => state.open)
  const [retainForExit, setRetainForExit] = useState(false)
  const [skipEnter, setSkipEnter] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)

  const gesturePhase = useMobileSiderSwipe({
    drawerRef,
    mainRef,
    maskRef,
    onGestureOpened: () => {
      setSkipEnter(true)
      setRetainForExit(true)
    },
    onGestureClosed: () => {
      setSkipEnter(false)
      setRetainForExit(false)
    },
  })

  useEffect(() => {
    if (open) {
      setRetainForExit(true)
    }
  }, [open])

  const gestureActive = gesturePhase !== 'idle'
  const closing = !open && !gestureActive && retainForExit

  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) {
      return
    }
    if (gestureActive) {
      delete main.dataset.siderState
      return
    }
    if (open) {
      main.dataset.siderState = skipEnter ? 'open-instant' : 'open'
    } else if (retainForExit) {
      main.dataset.siderState = 'closing'
    } else {
      delete main.dataset.siderState
    }
  }, [open, retainForExit, skipEnter, gestureActive, mainRef])

  useEffect(() => {
    const main = mainRef.current
    return () => {
      if (main) {
        delete main.dataset.siderState
        delete main.dataset.siderGesture
      }
    }
  }, [mainRef])

  if (!open && !retainForExit && !gestureActive) {
    return null
  }
  return (
    <div
      className={styles.drawerLayer}
      data-closing={closing ? '' : undefined}
      data-gesture={gestureActive ? gesturePhase : undefined}
      data-skip-enter={skipEnter ? '' : undefined}
      ref={(node) => {
        if (node) {
          node.inert = closing
        }
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          setRetainForExit(false)
          setSkipEnter(false)
        }
      }}
    >
      <div
        ref={maskRef}
        className={styles.drawerMask}
        onClick={() => {
          if (!gestureActive) {
            closeMobileSider()
          }
        }}
      />
      <div ref={drawerRef} className={styles.drawer}>
        <Sider mobile />
      </div>
    </div>
  )
}
