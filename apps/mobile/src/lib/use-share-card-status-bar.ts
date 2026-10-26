import { useEffect, useState } from 'react'
import { Platform, StatusBar } from 'react-native'
/** RN Modal copies its Android window appearance when it is created. Install
 * the scoped status-bar entry before mounting that window on the next frame. */
export function useShareCardStatusBar(open: boolean, nativeWindowStyle = false): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'android' || nativeWindowStyle) return
    if (!open) {
      setReady(false)
      return
    }
    const entry = StatusBar.pushStackEntry({ barStyle: 'dark-content' })
    const frame = requestAnimationFrame(() => setReady(true))
    return () => {
      cancelAnimationFrame(frame)
      StatusBar.popStackEntry(entry)
      setReady(false)
    }
  }, [open, nativeWindowStyle])
  return open && (Platform.OS !== 'android' || nativeWindowStyle || ready)
}
