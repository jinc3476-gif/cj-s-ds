import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { DEFAULT_MODEL, type ChatModel } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ChatFontSize = 'small' | 'standard' | 'large'
export const chatFontPixels = { small: 14, standard: 16, large: 20 } satisfies Record<
  ChatFontSize,
  number
>

export type ReplyStylePreset = 'default' | 'concise' | 'detailed' | 'professional' | 'casual'
export type ReplyLanguagePreference = 'auto' | 'zh-CN' | 'zh-TW' | 'en' | 'ja'

export type Personalization = {
  enabled: boolean
  nickname: string
  background: string
  stylePreset: ReplyStylePreset
  languagePreference: ReplyLanguagePreference
  customInstructions: string
}

export const DEFAULT_PERSONALIZATION: Personalization = {
  enabled: true,
  nickname: '',
  background: '',
  stylePreset: 'default',
  languagePreference: 'auto',
  customInstructions: '',
}

const BASE_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

const STYLE_PROMPTS: Record<Exclude<ReplyStylePreset, 'default'>, string> = {
  concise: '回答请尽量简洁直接，突出重点，避免冗余铺垫。',
  detailed: '回答请详尽深入，提供清晰的步骤、背景与示例。',
  professional: '回答请保持专业、严谨、结构化的表达风格。',
  casual: '回答请使用自然、轻松、友好且易于理解的语气。',
}

const LANGUAGE_PROMPTS: Record<Exclude<ReplyLanguagePreference, 'auto'>, string> = {
  'zh-CN': '除非用户另有要求，请始终使用简体中文回复。',
  'zh-TW': '除非用戶另有要求，請始終使用繁體中文回覆。',
  en: 'Unless otherwise requested by the user, always respond in English.',
  ja: 'ユーザーから別段の指示がない限り、常に日本語で回答してください。',
}

export const hasPersonalizationContent = (p: Personalization): boolean =>
  Boolean(
    p.nickname.trim() ||
      p.background.trim() ||
      p.stylePreset !== 'default' ||
      p.languagePreference !== 'auto' ||
      p.customInstructions.trim()
  )

/** 合并基础身份说明与全局自定义指令，生成请求 system 提示词 */
export const buildSystemPrompt = (p: Personalization): string => {
  if (!p.enabled || !hasPersonalizationContent(p)) {
    return BASE_SYSTEM_PROMPT
  }
  const sections: string[] = []
  const nickname = p.nickname.trim()
  const background = p.background.trim()
  const custom = p.customInstructions.trim()
  if (nickname) {
    sections.push(`请称呼用户为「${nickname}」。`)
  }
  if (background) {
    sections.push(`关于用户背景：\n${background}`)
  }
  if (p.stylePreset !== 'default') {
    sections.push(`回复风格偏好：${STYLE_PROMPTS[p.stylePreset]}`)
  }
  if (p.languagePreference !== 'auto') {
    sections.push(`语言偏好：${LANGUAGE_PROMPTS[p.languagePreference]}`)
  }
  if (custom) {
    sections.push(`其他回复要求：\n${custom}`)
  }
  return `${BASE_SYSTEM_PROMPT}\n\n[用户自定义指令]\n${sections.join('\n\n')}`
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、个性化指令、当前模型、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  chatFontSize: ChatFontSize
  location: UserLocation | null
  ttsVoice: TtsVoice
  personalization: Personalization
  model: ChatModel
  availableModels: string[]
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  chatFontSize: 'jianliao:chat-font-size',
  ttsVoice: 'chat-demo:tts-voice',
  personalization: 'quovia:personalization',
  model: 'quovia:model',
  availableModels: 'quovia:available-models',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    if (key === KEYS.apiKey && window.AndroidBridge) {
      return window.AndroidBridge.getApiKey() || null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  if (key === KEYS.apiKey && window.AndroidBridge) {
    if (!window.AndroidBridge.setApiKey(value ?? '')) {
      throw new Error('无法安全保存 API Key')
    }
    localStorage.removeItem(key)
    return
  }
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialChatFontSize = (): ChatFontSize => {
  const saved = read(KEYS.chatFontSize)
  return saved === 'small' || saved === 'large' ? saved : 'standard'
}

const VALID_STYLES: ReplyStylePreset[] = ['default', 'concise', 'detailed', 'professional', 'casual']
const VALID_LANGS: ReplyLanguagePreference[] = ['auto', 'zh-CN', 'zh-TW', 'en', 'ja']

const normalizePersonalization = (raw: unknown): Personalization => {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_PERSONALIZATION }
  }
  const value = raw as Record<string, unknown>
  const stylePreset = VALID_STYLES.includes(value.stylePreset as ReplyStylePreset)
    ? (value.stylePreset as ReplyStylePreset)
    : 'default'
  const languagePreference = VALID_LANGS.includes(
    value.languagePreference as ReplyLanguagePreference
  )
    ? (value.languagePreference as ReplyLanguagePreference)
    : 'auto'
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    nickname: typeof value.nickname === 'string' ? value.nickname.slice(0, 60) : '',
    background: typeof value.background === 'string' ? value.background.slice(0, 1500) : '',
    stylePreset,
    languagePreference,
    customInstructions:
      typeof value.customInstructions === 'string' ? value.customInstructions.slice(0, 1500) : '',
  }
}

const initialPersonalization = (): Personalization => {
  try {
    return normalizePersonalization(JSON.parse(read(KEYS.personalization) ?? 'null'))
  } catch {
    return { ...DEFAULT_PERSONALIZATION }
  }
}

const initialModel = (): ChatModel => {
  const saved = read(KEYS.model)?.trim()
  return saved ? (saved as ChatModel) : DEFAULT_MODEL
}

const initialAvailableModels = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.availableModels) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : []
  } catch {
    return []
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  chatFontSize: initialChatFontSize(),
  ttsVoice: initialTtsVoice(),
  personalization: initialPersonalization(),
  model: initialModel(),
  availableModels: initialAvailableModels(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setPersonalization = (patch: Partial<Personalization>) => {
  const next = normalizePersonalization({ ...useSettings.getState().personalization, ...patch })
  write(KEYS.personalization, JSON.stringify(next))
  useSettings.setState({ personalization: next })
}

export const resetPersonalization = () => {
  const next = { ...DEFAULT_PERSONALIZATION }
  write(KEYS.personalization, null)
  useSettings.setState({ personalization: next })
}

export const setModel = (model: ChatModel) => {
  const normalized = (model.trim() || DEFAULT_MODEL) as ChatModel
  write(KEYS.model, normalized)
  useSettings.setState({ model: normalized })
}

export const setAvailableModels = (models: string[]) => {
  const unique = [...new Set(models.map((item) => item.trim()).filter(Boolean))]
  write(KEYS.availableModels, unique.length > 0 ? JSON.stringify(unique) : null)
  useSettings.setState({ availableModels: unique })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setChatFontSize = (chatFontSize: ChatFontSize) => {
  write(KEYS.chatFontSize, chatFontSize)
  useSettings.setState({ chatFontSize })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
