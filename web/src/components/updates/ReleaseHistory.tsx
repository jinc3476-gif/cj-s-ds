import { useState } from 'react'
import history from '../../../../release-history.json' with { type: 'json' }
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import styles from './ReleaseHistory.module.css'

export const ReleaseHistoryButton = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton
        size="xl"
        tone="primary"
        tooltip={t('releaseHistory')}
        tooltipPlacement="bottom"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        icon={
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9Z" />
            <path d="M10 20a2.2 2.2 0 0 0 4 0" />
          </svg>
        }
      />
      {open && <ReleaseHistoryDialog onClose={() => setOpen(false)} />}
    </>
  )
}

const ReleaseHistoryDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <Modal title={t('releaseHistory')} mainClassName={styles.history} closable onClose={onClose}>
      {history.map((release) => (
        <section key={release.version} className={styles.release}>
          <h3>
            <span className={release.version === __APP_VERSION__ ? 'quovia-wordmark' : undefined}>v{release.version}</span>{' '}
            {release.version === __APP_VERSION__ && <small>{t('installedVersion')}</small>}
          </h3>
          <ul>
            {release[locale].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
    </Modal>
  )
}
