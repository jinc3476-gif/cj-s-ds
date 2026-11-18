import { createId } from '../../utils/id.js'
import type { Recording } from './recorder.js'

type RecorderEvent = {
  id: string
  state: 'recording' | 'data' | 'result' | 'error' | 'cancelled'
  data?: string
  error?: 'permission' | 'failed'
  limited?: boolean
}

export const supportsNativeRecording = () => Boolean(
  window.AndroidBridge?.startNativeRecording &&
  window.AndroidBridge.stopNativeRecording &&
  window.AndroidBridge.cancelNativeRecording
)

export const startNativeRecording = (
  onLimit: () => void,
  signal: AbortSignal
): Promise<Recording> => new Promise((resolve, reject) => {
  const bridge = window.AndroidBridge
  if (!bridge?.startNativeRecording || !bridge.stopNativeRecording || !bridge.cancelNativeRecording) {
    reject(new Error('Native recording is unavailable'))
    return
  }
  const id = createId()
  const chunks: ArrayBuffer[] = []
  let started = false
  let cancelled = false
  let resolveAudio: (audio: Blob | null) => void
  let rejectAudio: (error: Error) => void
  const audio = new Promise<Blob | null>((yes, no) => {
    resolveAudio = yes
    rejectAudio = no
  })
  const cleanup = () => {
    window.removeEventListener('jianliao-recorder', onEvent)
    signal.removeEventListener('abort', abort)
  }
  const abort = () => {
    cancelled = true
    bridge.cancelNativeRecording?.(id)
    cleanup()
    const error = new DOMException('Cancelled', 'AbortError')
    if (!started) {
      reject(error)
    } else {
      rejectAudio(error)
    }
  }
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<RecorderEvent>).detail
    if (!detail || detail.id !== id) {
      return
    }
    if (detail.state === 'recording') {
      started = true
      resolve({
        stop: () => {
          bridge.stopNativeRecording?.(id)
          return audio
        },
        cancel: () => {
          if (cancelled) {
            return
          }
          cancelled = true
          bridge.cancelNativeRecording?.(id)
          cleanup()
          resolveAudio(null)
        },
      })
    } else if (detail.state === 'data' && detail.data) {
      const binary = atob(detail.data)
      chunks.push(Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer)
    } else if (detail.state === 'result') {
      cleanup()
      if (detail.limited) {
        onLimit()
      }
      resolveAudio(chunks.length ? new Blob(chunks, { type: 'audio/wav' }) : null)
    } else if (detail.state === 'error') {
      cleanup()
      const error = detail.error === 'permission'
        ? new DOMException('Microphone permission denied', 'NotAllowedError')
        : new DOMException('Could not start audio source', 'NotReadableError')
      if (!started) {
        reject(error)
      } else {
        rejectAudio(error)
      }
    } else if (detail.state === 'cancelled') {
      cleanup()
      if (!started) {
        reject(new DOMException('Cancelled', 'AbortError'))
      } else {
        rejectAudio(new DOMException('Cancelled', 'AbortError'))
      }
    }
  }
  window.addEventListener('jianliao-recorder', onEvent)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) {
    abort()
    return
  }
  try {
    bridge.startNativeRecording(id)
  } catch (error) {
    cleanup()
    reject(error)
  }
})
