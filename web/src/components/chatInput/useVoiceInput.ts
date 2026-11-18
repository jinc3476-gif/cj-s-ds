import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationKey } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { createId } from '../../utils/id.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'

export type VoiceInputStatus = 'idle' | 'starting' | 'recording' | 'transcribing'
type NativeEvent = {
  id: string
  state: 'recording' | 'transcribing' | 'result' | 'error' | 'cancelled'
  text?: string
  error?: 'permission' | 'empty' | 'network' | 'unavailable' | 'failed'
}
const nativeErrors: Record<NonNullable<NativeEvent['error']>, TranslationKey> = {
  permission: 'voiceInputPermissionDenied',
  empty: 'voiceInputEmpty',
  network: 'voiceInputNetwork',
  unavailable: 'voiceInputUnavailable',
  failed: 'voiceInputFailed',
}
const describeError = (error: unknown): TranslationKey => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'voiceInputPermissionDenied'
    }
    if (error.name === 'NotFoundError') {
      return 'voiceInputNoDevice'
    }
    if (error.name === 'NotReadableError') {
      return 'voiceInputDeviceBusy'
    }
  }
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return 'voiceInputServiceUnavailable'
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return 'voiceInputKeyInvalid'
    case 'insufficientBalance':
      return 'voiceInputBalance'
    case 'network':
      return 'voiceInputNetwork'
    default:
      return 'voiceInputFailed'
  }
}
type Session = {
  id: string
  native: boolean
  starting: boolean
  startupTimer?: number
  recording?: Recording
  controller: AbortController
}

export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const active = useRef<Session | null>(null)
  const nativeUnavailable = useRef(false)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const accept = useCallback((text?: string) => {
    if (text?.trim()) {
      onTextRef.current(text.trim())
    } else {
      showToast({ key: 'voiceInputEmpty' })
    }
  }, [])

  const cancel = useCallback(() => {
    const session = active.current
    active.current = null
    window.clearTimeout(session?.startupTimer)
    if (session?.native) {
      window.AndroidBridge?.cancelNativeSpeech?.(session.id)
    }
    session?.controller.abort()
    session?.recording?.cancel()
    setStatus('idle')
  }, [])

  const finish = useCallback(async () => {
    const session = active.current
    if (!session) {
      return
    }
    if (session.starting) {
      cancel()
      return
    }
    if (session.native) {
      window.AndroidBridge?.stopNativeSpeech?.(session.id)
      return
    }
    const recording = session.recording
    if (!recording) {
      cancel()
      return
    }
    delete session.recording
    setStatus('transcribing')
    try {
      const audio = await recording.stop()
      if (active.current !== session) {
        return
      }
      const text = audio
        ? await transcribe(useSettings.getState().apiKey ?? '', audio, session.controller.signal)
        : ''
      if (active.current === session) {
        accept(text)
      }
    } catch (error) {
      if (active.current === session) {
        showToast({ key: describeError(error) })
      }
    } finally {
      recording.cancel()
      if (active.current === session) {
        active.current = null
        setStatus('idle')
      }
    }
  }, [accept, cancel])

  const start = useCallback(async () => {
    if (active.current) {
      return
    }
    const bridge = window.AndroidBridge
    const native =
      !nativeUnavailable.current &&
      Boolean(
        bridge?.startNativeSpeech &&
        bridge.stopNativeSpeech &&
        bridge.cancelNativeSpeech &&
        bridge.hasNativeSpeech?.()
      )
    if (!native) {
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !window.AudioContext
      ) {
        showToast({
          key: window.isSecureContext ? 'voiceInputUnavailable' : 'voiceInputRequiresHttps',
        })
        return
      }
      if (!ensureApiKey()) {
        return
      }
    }
    const session: Session = { id: createId(), native, starting: true, controller: new AbortController() }
    active.current = session
    setSeconds(0)
    setStatus('starting')
    // Both permission prompts and bridge calls can remain pending without an error.
    session.startupTimer = window.setTimeout(() => {
      if (active.current !== session || !session.starting) return
      cancel()
      showToast({ key: 'voiceInputStartTimeout' })
    }, 18_000)
    try {
      if (native) {
        bridge?.startNativeSpeech?.(session.id, useSettings.getState().locale)
        return
      }
      const recording = await startRecording(() => {
        if (active.current === session) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      }, session.controller.signal)
      if (active.current !== session) {
        recording.cancel()
        return
      }
      session.recording = recording
      session.starting = false
      window.clearTimeout(session.startupTimer)
      setStatus('recording')
    } catch (error) {
      if (active.current === session) {
        cancel()
        showToast({ key: describeError(error) })
      }
    }
  }, [cancel, finish])

  useEffect(() => {
    const onNativeEvent = (event: Event) => {
      const detail = (event as CustomEvent<NativeEvent>).detail
      if (!detail || !active.current?.native || active.current.id !== detail.id) {
        return
      }
      window.clearTimeout(active.current.startupTimer)
      active.current.starting = false
      if (detail.state === 'recording' || detail.state === 'transcribing') {
        setStatus(detail.state)
        return
      }
      active.current = null
      setStatus('idle')
      if (detail.state === 'result') {
        accept(detail.text)
      }
      if (detail.state === 'error') {
        if (detail.error === 'unavailable') {
          nativeUnavailable.current = true
          showToast({ key: 'voiceInputNativeFallback' })
        } else {
          showToast({ key: nativeErrors[detail.error ?? 'failed'] })
        }
      }
    }
    const onHidden = () => {
      if (document.hidden) {
        cancel()
      }
    }
    window.addEventListener('jianliao-speech', onNativeEvent)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('jianliao-speech', onNativeEvent)
      document.removeEventListener('visibilitychange', onHidden)
      cancel()
    }
  }, [accept, cancel])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const since = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - since) / 1000)), 500)
    return () => clearInterval(timer)
  }, [status])

  return { status, seconds, start, finish, cancel }
}
