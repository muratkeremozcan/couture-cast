import { useCallback, useSyncExternalStore } from 'react'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import {
  androidNavigationSnapshot,
  setAndroidSpotlightDetail,
  subscribeAndroidNavigation,
} from '@/src/lib/android-navigation-restoration'
import { useAndroidPresentationRoot } from './android-share-card-presentation'

/** A detail retains only its ID; the screen supplies a freshly authorized Spotlight item. */
export function useAndroidSpotlightDetailPresentation() {
  const root = useAndroidPresentationRoot()
  const snapshot = useSyncExternalStore(
    subscribeAndroidNavigation,
    androidNavigationSnapshot
  )
  const active =
    !root ||
    (snapshot.root === root &&
      snapshot.path === '/community' &&
      !snapshot.restoration &&
      snapshot.checkpoint?.member === mobileApplicationUserId())
  const setPostId = useCallback(
    (postId: string | null) => {
      if (root) setAndroidSpotlightDetail(root, postId)
    },
    [root]
  )
  return {
    managed: root !== null,
    active,
    postId: active ? (snapshot.checkpoint?.detailId ?? null) : null,
    setPostId,
  }
}
