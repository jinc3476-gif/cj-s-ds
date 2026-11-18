import { useEffect, useRef, type PointerEvent } from 'react'

export const useVoicePress = (start: () => void, finish: () => void, cancel: () => void) => {
  const gesture = useRef<{ pointer: number; timer: number; held: boolean } | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => () => window.clearTimeout(gesture.current?.timer), [])

  const end = (event: PointerEvent, cancelled: boolean) => {
    const current = gesture.current
    if (current?.pointer !== event.pointerId) {
      return
    }
    gesture.current = null
    window.clearTimeout(current.timer)
    if (current.held) {
      suppressClick.current = true
      if (cancelled) {
        cancel()
      } else {
        finish()
      }
    }
  }
  return {
    begin(event: PointerEvent, enabled: boolean) {
      if (!event.isPrimary || event.button !== 0 || gesture.current) {
        return
      }
      suppressClick.current = false
      if (!enabled) {
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      const timer = window.setTimeout(() => {
        if (!gesture.current) {
          return
        }
        gesture.current.held = true
        start()
      }, 320)
      gesture.current = { pointer: event.pointerId, timer, held: false }
    },
    onPointerUp: (event: PointerEvent) => end(event, false),
    onPointerCancel: (event: PointerEvent) => end(event, true),
    onLostPointerCapture: (event: PointerEvent) => end(event, true),
    consumeClick() {
      const suppressed = suppressClick.current
      suppressClick.current = false
      return suppressed
    },
  }
}
