'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SwipeNavigationOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  threshold?: number
  preventDefaultTouches?: boolean
  enabled?: boolean
}

interface TouchState {
  startX: number
  startY: number
  startTime: number
  isScrolling?: boolean
}

export const useSwipeNavigation = ({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  preventDefaultTouches = false,
  enabled = true
}: SwipeNavigationOptions = {}) => {
  const [touchState, setTouchState] = useState<TouchState | null>(null)
  const [isSwipeInProgress, setIsSwipeInProgress] = useState(false)
  const elementRef = useRef<HTMLElement | null>(null)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return

    const touch = e.touches[0]
    setTouchState({
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now()
    })
    setIsSwipeInProgress(true)

    if (preventDefaultTouches) {
      e.preventDefault()
    }
  }, [enabled, preventDefaultTouches])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !touchState) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchState.startX
    const deltaY = touch.clientY - touchState.startY

    // Determine if this is more of a horizontal or vertical scroll
    if (touchState.isScrolling === undefined) {
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)
      setTouchState(prev => prev ? { ...prev, isScrolling: !isHorizontal } : null)
      
      if (!isHorizontal && !preventDefaultTouches) {
        // Allow vertical scrolling
        return
      }
    }

    // Prevent default only for horizontal swipes or when explicitly requested
    if (preventDefaultTouches || !touchState.isScrolling) {
      e.preventDefault()
    }
  }, [enabled, touchState, preventDefaultTouches])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!enabled || !touchState) {
      setIsSwipeInProgress(false)
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchState.startX
    const deltaY = touch.clientY - touchState.startY
    const deltaTime = Date.now() - touchState.startTime

    // Reset states
    setTouchState(null)
    setIsSwipeInProgress(false)

    // Don't trigger swipe if it was more of a vertical scroll
    if (touchState.isScrolling) return

    // Check if swipe meets criteria
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)
    
    // Must be primarily horizontal and meet threshold
    if (absX > threshold && absX > absY && deltaTime < 500) {
      if (deltaX > 0 && onSwipeRight) {
        onSwipeRight()
      } else if (deltaX < 0 && onSwipeLeft) {
        onSwipeLeft()
      }
    }

    if (preventDefaultTouches) {
      e.preventDefault()
    }
  }, [enabled, touchState, threshold, onSwipeLeft, onSwipeRight, preventDefaultTouches])

  const handleTouchCancel = useCallback(() => {
    setTouchState(null)
    setIsSwipeInProgress(false)
  }, [])

  // Attach event listeners
  useEffect(() => {
    const element = elementRef.current
    if (!element || !enabled) return

    // Use passive listeners for better performance, except when preventing default
    const options = preventDefaultTouches ? { passive: false } : { passive: true }

    element.addEventListener('touchstart', handleTouchStart, options)
    element.addEventListener('touchmove', handleTouchMove, options)
    element.addEventListener('touchend', handleTouchEnd, options)
    element.addEventListener('touchcancel', handleTouchCancel, options)

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [
    enabled,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    preventDefaultTouches
  ])

  // Helper function to navigate between tabs
  const createTabNavigationHandlers = (tabs: string[], currentTab: string, onTabChange: (tab: string) => void) => {
    const currentIndex = tabs.findIndex(tab => tab === currentTab)
    
    return {
      onSwipeLeft: () => {
        const nextIndex = Math.min(currentIndex + 1, tabs.length - 1)
        if (nextIndex !== currentIndex) {
          onTabChange(tabs[nextIndex])
        }
      },
      onSwipeRight: () => {
        const prevIndex = Math.max(currentIndex - 1, 0)
        if (prevIndex !== currentIndex) {
          onTabChange(tabs[prevIndex])
        }
      }
    }
  }

  return {
    elementRef,
    isSwipeInProgress,
    createTabNavigationHandlers
  }
}
