declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string
declare const __APP_VERSION__: string

interface Window {
  AndroidBridge?: {
    getApiKey(): string
    setApiKey(key: string): boolean
    saveDownload(name: string, base64: string): void
    checkForUpdate?(): void
    getAppVersion?(): string
    isUpdateConfigured?(): boolean
    startNativeRecording?(id: string): void
    stopNativeRecording?(id: string): void
    cancelNativeRecording?(id: string): void
  }
  handleAndroidBack?: () => boolean
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
