import { translate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../../components/base/toastState.js'
import { getVisibleMessages, normalizeSession } from './branches.js'
import { getReplyText } from './reply.js'
import { loadSessionForExport, useChatStore } from './store.js'
import type { Session } from './types.js'

const sanitizeFilename = (raw: string): string => {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  return cleaned || `quovia-chat-${new Date().toISOString().slice(0, 10)}`
}

const toBase64Utf8 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 将单个会话的当前可见分支格式化为易读的 Markdown 文本 */
export const formatSessionMarkdown = (session: Session, projectName?: string): string => {
  const normalized = normalizeSession(session)
  const messages = getVisibleMessages(normalized)
  const title = normalized.title || translate('untitledChat')
  const heading = projectName ? `${projectName} / ${title}` : title
  const lines: string[] = [`# ${heading}`, '']
  const timestamp = new Date(normalized.updatedAt).toLocaleString()
  lines.push(`> ${timestamp}`, '')

  for (const message of messages) {
    if (message.role === 'user') {
      lines.push(`## ${translate('chatExportUser')}`, '')
      if (message.files.length > 0) {
        lines.push(
          `**${translate('chatExportFiles')}**: ${message.files.map((file) => `\`${file.name}\``).join(', ')}`,
          ''
        )
      }
      if (message.content.trim()) {
        lines.push(message.content.trim(), '')
      }
      continue
    }

    const label = message.model
      ? `${translate('chatExportAssistant')} (${message.model})`
      : translate('chatExportAssistant')
    lines.push(`## ${label}`, '')

    const thoughts = message.blocks
      .filter((block) => block.type === 'thinking' && block.thinking.trim())
      .map((block) => (block.type === 'thinking' ? block.thinking.trim() : ''))
      .join('\n\n')
    if (thoughts) {
      lines.push(
        `<details>`,
        `<summary>${translate('chatExportThinking')}</summary>`,
        '',
        thoughts,
        '',
        `</details>`,
        ''
      )
    }

    const answer = getReplyText(message).trim()
    if (answer) {
      lines.push(answer, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

const resolveSessionAndProject = async (
  sessionOrId: Session | string
): Promise<{ session: Session; projectName?: string } | null> => {
  const session =
    typeof sessionOrId === 'string' ? await loadSessionForExport(sessionOrId) : sessionOrId
  if (!session) {
    return null
  }
  const projectName = session.projectId
    ? useChatStore.getState().projects.find((project) => project.id === session.projectId)?.name
    : undefined
  return { session, projectName }
}

/** 复制单条会话全文（Markdown）到剪贴板 */
export const copySessionFullText = async (sessionOrId: Session | string): Promise<boolean> => {
  const resolved = await resolveSessionAndProject(sessionOrId)
  if (!resolved) {
    showToast({ key: 'copyFailed', type: 'error' })
    return false
  }
  const markdown = formatSessionMarkdown(resolved.session, resolved.projectName)
  const ok = await copyText(markdown)
  showToast(ok ? { key: 'copyFullChatDone' } : { key: 'copyFailed', type: 'error' })
  return ok
}

/** 导出单条会话为 .md 文件（Android 走系统文档保存器，浏览器触发下载） */
export const exportSessionMarkdown = async (sessionOrId: Session | string): Promise<boolean> => {
  try {
    const resolved = await resolveSessionAndProject(sessionOrId)
    if (!resolved) {
      showToast({ key: 'exportMarkdownFailed', type: 'error' })
      return false
    }
    const markdown = formatSessionMarkdown(resolved.session, resolved.projectName)
    const name = `${sanitizeFilename(resolved.session.title || translate('untitledChat'))}.md`
    if (window.AndroidBridge) {
      window.AndroidBridge.saveDownload(name, toBase64Utf8(markdown))
      return true
    }
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    showToast({ key: 'exportMarkdownFailed', type: 'error' })
    return false
  }
}
