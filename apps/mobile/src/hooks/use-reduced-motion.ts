import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** Defaults to reduced motion until the system preference resolves. */
export function useReducedMotion(): boolean {
  const [isReducedMotion, setIsReducedMotion] = useState(true)

  useEffect(() => {
    let isMounted = true
    let preferenceChanged = false

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        preferenceChanged = true
        if (isMounted) {
          setIsReducedMotion(enabled)
        }
      }
    )

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted && !preferenceChanged) {
          setIsReducedMotion(enabled)
        }
      })
      .catch(() => {
        if (isMounted && !preferenceChanged) {
          setIsReducedMotion(true)
        }
      })

    return () => {
      isMounted = false
      subscription?.remove()
    }
  }, [])

  return isReducedMotion
}
