import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSearchPanel } from '../search/searchPanelState.js'
import { useSettingsDialog } from '../settings/settingsDialogState.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'

export type SwipeGesturePhase = 'idle' | 'dragging' | 'settling'

// 参考 DeepSeek 手机端 App 的侧滑抽屉手感参数
const LOCK_DISTANCE = 10
const DIRECTION_RATIO = 1.2
const VERTICAL_CANCEL_RATIO = 0.85
const OPEN_DISTANCE_RATIO = 0.35
const CLOSE_DISTANCE_RATIO = 0.3
const FLICK_VELOCITY = 0.28
const FLICK_MIN_PX = 18
const MIN_SETTLE_MS = 140
const MAX_SETTLE_MS = 280
const SETTLE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getDrawerWidth = (drawer: HTMLElement | null) =>
  drawer?.offsetWidth || Math.min(308, Math.max(200, window.innerWidth - 56))

const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isBlockedTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [data-no-sider-swipe], [role="dialog"], [role="menu"], [role="listbox"]'
    )
  )
}

const hasActiveOverlay = () =>
  useSettingsDialog.getState().open ||
  useSearchPanel.getState().entry !== null ||
  Boolean(document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]'))

/** 向右划时，若手指位于还能往左回滚的横向滚动容器（如宽代码块/表格）内，优先保留内容滚动。 */
const canScrollRightInAncestor = (target: EventTarget | null) => {
  for (
    let el = target instanceof Element ? target : null;
    el && el !== document.body;
    el = el.parentElement
  ) {
    const style = getComputedStyle(el)
    if (
      /auto|scroll/.test(style.overflowX) &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.scrollLeft > 1
    ) {
      return true
    }
  }
  return false
}

const hasTextSelection = () => {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0)
}

/** 根据剩余路程与松手甩动速度动态计算落位时长，近距离干脆落位、轻甩顺滑滑行。 */
const computeSettleDuration = (remainingRatio: number, velocityAbs: number) => {
  const base = 150 + remainingRatio * 130
  const velocityBoost = Math.min(60, velocityAbs * 45)
  return Math.round(clamp(base - velocityBoost, MIN_SETTLE_MS, MAX_SETTLE_MS))
}

const applyPushVisual = (
  drawer: HTMLElement | null,
  main: HTMLElement | null,
  mask: HTMLElement | null,
  progress: number,
  width: number
) => {
  if (drawer) {
    drawer.style.transform = `translate3d(${(progress - 1) * width}px, 0, 0)`
  }
  if (main) {
    main.style.transform = `translate3d(${progress * width}px, 0, 0)`
  }
  if (mask) {
    mask.style.opacity = String(progress)
  }
}

const applySettleTransition = (
  drawer: HTMLElement | null,
  main: HTMLElement | null,
  mask: HTMLElement | null,
  durationMs: number
) => {
  const transformTransition = `transform ${durationMs}ms ${SETTLE_EASING}`
  if (drawer) {
    drawer.style.transition = transformTransition
  }
  if (main) {
    main.style.transition = transformTransition
  }
  if (mask) {
    mask.style.transition = `opacity ${durationMs}ms ease-out`
  }
}

const clearPushVisual = (
  drawer: HTMLElement | null,
  main: HTMLElement | null,
  mask: HTMLElement | null
) => {
  if (drawer) {
    drawer.style.removeProperty('transform')
    drawer.style.removeProperty('transition')
  }
  if (main) {
    main.style.removeProperty('transform')
    main.style.removeProperty('transition')
    delete main.dataset.siderGesture
  }
  if (mask) {
    mask.style.removeProperty('opacity')
    mask.style.removeProperty('transition')
  }
}

/**
 * 参考 DeepSeek 手机端 App 的联动推拉侧滑手势：
 * - 抽屉关闭时，在页面任意非冲突位置向右滑，左侧抽屉与主页面 1:1 联动向右推开；
 * - 抽屉打开时，向左滑实时联动推回；
 * - 拖拽期间直接操作 GPU 合成层 transform / opacity，松手按剩余距离与速度动态平滑落位。
 */
export const useMobileSiderSwipe = ({
  drawerRef,
  mainRef,
  maskRef,
  onGestureOpened,
  onGestureClosed,
}: {
  drawerRef: RefObject<HTMLDivElement | null>
  mainRef: RefObject<HTMLElement | null>
  maskRef: RefObject<HTMLDivElement | null>
  onGestureOpened: () => void
  onGestureClosed: () => void
}) => {
  const [phase, setPhase] = useState<SwipeGesturePhase>('idle')
  const phaseRef = useRef<SwipeGesturePhase>('idle')
  const progressRef = useRef(0)
  const widthRef = useRef(308)
  const callbacksRef = useRef({ onGestureOpened, onGestureClosed })
  callbacksRef.current = { onGestureOpened, onGestureClosed }

  const updatePhase = (next: SwipeGesturePhase) => {
    phaseRef.current = next
    setPhase(next)
  }

  // 在绘制前同步初始位置与手势标记；回到 idle 时在同帧清理内联样式，杜绝闪帧。
  useLayoutEffect(() => {
    const main = mainRef.current
    if (phase === 'dragging') {
      widthRef.current = getDrawerWidth(drawerRef.current)
      if (main) {
        main.dataset.siderGesture = 'dragging'
        main.style.removeProperty('transition')
      }
      applyPushVisual(
        drawerRef.current,
        main,
        maskRef.current,
        progressRef.current,
        widthRef.current
      )
    } else if (phase === 'settling') {
      if (main) {
        main.dataset.siderGesture = 'settling'
      }
    } else {
      clearPushVisual(drawerRef.current, main, maskRef.current)
    }
  }, [phase, drawerRef, mainRef, maskRef])

  useEffect(() => {
    type Tracking = {
      status: 'pending' | 'dragging' | 'rejected'
      wasOpen: boolean
      startX: number
      startY: number
      dragOriginX: number
      lastX: number
      lastTime: number
      velocityX: number
      target: EventTarget | null
    }

    let tracking: Tracking | null = null
    let settleTimer = 0
    let settleRaf = 0

    const cancelPendingSettle = () => {
      window.clearTimeout(settleTimer)
      window.cancelAnimationFrame(settleRaf)
      settleTimer = 0
      settleRaf = 0
    }

    const finishGesture = (shouldOpen: boolean) => {
      cancelPendingSettle()
      if (shouldOpen) {
        callbacksRef.current.onGestureOpened()
        openMobileSider()
      } else {
        callbacksRef.current.onGestureClosed()
        closeMobileSider()
      }
      updatePhase('idle')
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || phaseRef.current === 'settling') {
        tracking = null
        return
      }
      if (hasActiveOverlay() || hasTextSelection()) {
        tracking = null
        return
      }
      if (isBlockedTarget(event.target)) {
        tracking = null
        return
      }
      const touch = event.touches[0]
      const wasOpen = useMobileSider.getState().open
      tracking = {
        status: 'pending',
        wasOpen,
        startX: touch.clientX,
        startY: touch.clientY,
        dragOriginX: touch.clientX,
        lastX: touch.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        target: event.target,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || tracking.status === 'rejected') {
        return
      }
      if (event.touches.length !== 1) {
        if (tracking.status === 'dragging') {
          finishGesture(tracking.wasOpen)
        }
        tracking = null
        return
      }
      const touch = event.touches[0]
      const now = performance.now()
      const dx = touch.clientX - tracking.startX
      const dy = touch.clientY - tracking.startY

      if (tracking.status === 'pending') {
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        if (absX < LOCK_DISTANCE && absY < LOCK_DISTANCE) {
          return
        }
        // 纵向滚动优先，保证聊天内容和侧栏列表上下滑动零阻碍
        if (absY > absX * VERTICAL_CANCEL_RATIO) {
          tracking.status = 'rejected'
          return
        }
        const validDirection = tracking.wasOpen
          ? dx < -LOCK_DISTANCE && absX > absY * DIRECTION_RATIO
          : dx > LOCK_DISTANCE && absX > absY * DIRECTION_RATIO
        if (!validDirection) {
          tracking.status = 'rejected'
          return
        }
        if (!tracking.wasOpen && canScrollRightInAncestor(tracking.target)) {
          tracking.status = 'rejected'
          return
        }
        tracking.status = 'dragging'
        tracking.dragOriginX = touch.clientX
        tracking.lastX = touch.clientX
        tracking.lastTime = now
        tracking.velocityX = 0
        widthRef.current = getDrawerWidth(drawerRef.current)
        progressRef.current = tracking.wasOpen ? 1 : 0
        // 拉出侧栏时收起软键盘，让项目和对话列表完整可见
        if (!tracking.wasOpen && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        updatePhase('dragging')
      }

      if (event.cancelable) {
        event.preventDefault()
      }
      const dt = Math.max(1, now - tracking.lastTime)
      const instantVelocity = (touch.clientX - tracking.lastX) / dt
      tracking.velocityX = tracking.velocityX * 0.35 + instantVelocity * 0.65
      tracking.lastX = touch.clientX
      tracking.lastTime = now

      const width = getDrawerWidth(drawerRef.current)
      widthRef.current = width
      const dragDelta = touch.clientX - tracking.dragOriginX
      const progress = tracking.wasOpen
        ? clamp(1 + dragDelta / width, 0, 1)
        : clamp(dragDelta / width, 0, 1)
      progressRef.current = progress
      applyPushVisual(drawerRef.current, mainRef.current, maskRef.current, progress, width)
    }

    const onTouchEnd = (event: TouchEvent) => {
      const current = tracking
      tracking = null
      if (!current || current.status !== 'dragging') {
        return
      }
      const cancelled = event.type === 'touchcancel'
      const progress = progressRef.current
      const width = widthRef.current
      const vx = current.velocityX
      const draggedPx = Math.abs(current.lastX - current.dragOriginX)
      const shouldOpen = cancelled
        ? current.wasOpen
        : current.wasOpen
          ? !(
              progress < 1 - CLOSE_DISTANCE_RATIO ||
              (vx < -FLICK_VELOCITY && draggedPx >= FLICK_MIN_PX)
            )
          : progress > OPEN_DISTANCE_RATIO || (vx > FLICK_VELOCITY && draggedPx >= FLICK_MIN_PX)

      const targetProgress = shouldOpen ? 1 : 0
      const remainingRatio = Math.abs(targetProgress - progress)
      if (isReducedMotion() || remainingRatio < 0.01) {
        finishGesture(shouldOpen)
        return
      }

      const durationMs = computeSettleDuration(remainingRatio, Math.abs(vx))
      updatePhase('settling')
      settleRaf = window.requestAnimationFrame(() => {
        settleRaf = window.requestAnimationFrame(() => {
          const drawer = drawerRef.current
          const main = mainRef.current
          const mask = maskRef.current
          applySettleTransition(drawer, main, mask, durationMs)
          applyPushVisual(drawer, main, mask, targetProgress, width)
          let settled = false
          const complete = () => {
            if (settled) {
              return
            }
            settled = true
            drawer?.removeEventListener('transitionend', onTransitionEnd)
            finishGesture(shouldOpen)
          }
          const onTransitionEnd = (e: TransitionEvent) => {
            if (e.target === drawer && e.propertyName === 'transform') {
              complete()
            }
          }
          drawer?.addEventListener('transitionend', onTransitionEnd)
          settleTimer = window.setTimeout(complete, durationMs + 60)
        })
      })
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      cancelPendingSettle()
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [drawerRef, mainRef, maskRef])

  return phase
}
