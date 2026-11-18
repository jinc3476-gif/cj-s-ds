import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationKey } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { startNativeRecording, supportsNativeRecording } from '../../services/speech/nativeRecorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'

export type VoiceInputStatus = 'idle' | 'starting' | 'recording' | 'transcribing'
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
  starting: boolean
  startupTimer?: number
  recording?: Recording
  controller: AbortController
}

export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const active = useRef<Session | null>(null)
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
    const native = supportsNativeRecording()
    if (!native && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext)) {
      showToast({
        key: window.isSecureContext ? 'voiceInputUnavailable' : 'voiceInputRequiresHttps',
      })
      return
    }
    if (!ensureApiKey()) {
      return
    }
    const session: Session = { starting: true, controller: new AbortController() }
    active.current = session
    setSeconds(0)
    setStatus('starting')
    // A permission prompt can remain pending without an error.
    session.startupTimer = window.setTimeout(() => {
      if (active.current !== session || !session.starting) {
        return
      }
      cancel()
      showToast({ key: 'voiceInputStartTimeout' })
    }, 18_000)
    try {
      const onLimit = () => {
        if (active.current === session) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      }
      const recording = native
        ? await startNativeRecording(onLimit, session.controller.signal)
        : await startRecording(onLimit, session.controller.signal)
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
    const onHidden = () => {
      if (document.hidden) {
        cancel()
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      cancel()
    }
  }, [cancel])

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
