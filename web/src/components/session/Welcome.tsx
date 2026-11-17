import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.intro}>
          <div className={styles.mark} aria-hidden="true">
            <span />
            <span />
          </div>
          <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
          <p className={styles.subtitle}>{t('welcomeSubtitle')}</p>
          <div className={styles.suggestions}>
            {(['welcomeIdea', 'welcomeRead', 'welcomeWrite'] as const).map((key) => (
              <button
                key={key}
                onClick={() => {
                  const input = document.querySelector<HTMLTextAreaElement>('textarea')
                  if (!input) {
                    return
                  }
                  const setter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,
                    'value'
                  )?.set
                  setter?.call(input, t(key))
                  input.dispatchEvent(new Event('input', { bubbles: true }))
                  input.focus()
                }}
              >
                {t(key)} <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
