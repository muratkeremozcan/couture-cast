import React, {
  type ComponentProps,
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import { Linking, Platform } from 'react-native'
import type { ShareCardSource } from '@couture/api-client'
import {
  mobileApplicationUserId,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  type ShareCardHeadingScope,
  focusShareCardElement,
  shareCardHeadingNode,
} from '@/src/lib/share-card-focus'
import {
  acquireShareCardPresentation,
  changeShareCardWatermark,
  closeShareCardPresentation,
  openShareCardPresentation,
  retireShareCardPresentation,
  shareCardPresentationFocus,
  shareCardPresentationSnapshot,
  subscribeShareCardPresentation,
} from '@/src/lib/share-card-presentation'
import {
  acquireAndroidNavigation,
  androidNavigationIntent,
  androidNavigationSnapshot,
  claimAndroidRestoration,
  isCurrentAndroidRestoration,
  observeAndroidPath,
  subscribeAndroidNavigation,
  type AndroidRestorablePath,
} from '@/src/lib/android-navigation-restoration'
import { isNativeNotificationFixtureUrl } from '@/src/lib/native-notification-fixture'
import { isShareCardNativeFixtureUrl } from '@/src/lib/share-card-native-fixture-url'
import { ShareCardComposer } from './share-card-composer'

// Other platforms retain their existing screen-owned composer lifecycle.
export function ScreenShareCardComposer(props: ComponentProps<typeof ShareCardComposer>) {
  const root = useAndroidPresentationRoot()
  return root ? null : <ShareCardComposer {...props} />
}

const PresentationRoot = createContext<object | null>(null)
export const useAndroidPresentationRoot = () => useContext(PresentationRoot)
export function useAndroidNavigationIntent() {
  const root = useAndroidPresentationRoot()
  return (path: string) => {
    if (!root) return
    androidNavigationIntent(root, path)
    retireShareCardPresentation(root)
  }
}
function subscribeNavigationLinks(invalidate: (url: string) => void) {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (isNativeNotificationFixtureUrl(url) || isShareCardNativeFixtureUrl(url)) return
    invalidate(url)
    const root = shareCardPresentationSnapshot().root
    if (root) retireShareCardPresentation(root)
  })
  return () => subscription.remove()
}
export function useShareCardPresentationOpener() {
  const root = useContext(PresentationRoot)
  return (
    source: ShareCardSource,
    scope: ShareCardHeadingScope,
    node?: () => number | null
  ) => {
    if (!root) return false
    openShareCardPresentation(root, source, scope, node)
    return true
  }
}

/** Android recreates its Fabric root when system text size changes. */
export function AndroidShareCardPresentation({
  pathname,
  children,
  navigationReady,
  onRestoreRoute,
}: {
  pathname: string
  children?: React.ReactNode
  navigationReady?: boolean
  onRestoreRoute?: (path: AndroidRestorablePath) => void
}) {
  const root = useRef({}).current
  const previousPathname = useRef(pathname)
  const snapshot = useSyncExternalStore(
    subscribeShareCardPresentation,
    shareCardPresentationSnapshot
  )
  const member = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileApplicationUserId
  )
  const android = Platform.OS === 'android'
  const route = useSyncExternalStore(
    subscribeAndroidNavigation,
    androidNavigationSnapshot
  )
  const navigationEnabled = android && onRestoreRoute !== undefined
  useEffect(() => {
    if (!android) return
    const releaseCard = acquireShareCardPresentation(root)
    const releaseRoute = navigationEnabled
      ? acquireAndroidNavigation(root, pathname, subscribeNavigationLinks)
      : undefined
    return () => {
      releaseRoute?.()
      releaseCard()
    }
    // Each Fabric root acquires once. Path changes publish through the guarded observer.
  }, [android, navigationEnabled, root])
  useEffect(() => {
    const navigated = navigationEnabled
      ? observeAndroidPath(root, pathname) === 'navigated'
      : previousPathname.current !== pathname
    if (navigated) retireShareCardPresentation(root)
    previousPathname.current = pathname
  }, [pathname, root, member, navigationEnabled, route.intent])
  useEffect(() => {
    if (!navigationEnabled) return
    const request = claimAndroidRestoration(root, navigationReady === true)
    if (request && isCurrentAndroidRestoration(root, request.serial))
      onRestoreRoute?.(request.path)
  }, [navigationEnabled, navigationReady, onRestoreRoute, root, route.restoration])
  const onRoute =
    !navigationEnabled ||
    (route.root === root &&
      !route.restoration &&
      !route.intent &&
      route.path === pathname)
  const draft = snapshot.draft
  const current =
    android && onRoute && snapshot.root === root && draft?.member === member
      ? draft
      : null
  return (
    <PresentationRoot.Provider value={android && member ? root : null}>
      {children}
      {current && (
        <ShareCardComposer
          source={current.source}
          open={current.open}
          watermark={current.watermark}
          onWatermarkChange={(next) =>
            changeShareCardWatermark(root, current.serial, next)
          }
          onClose={() => closeShareCardPresentation(root, current.serial)}
          onRestoreFocus={() => {
            const focus = shareCardPresentationFocus(root, current.serial)
            if (focus.current)
              focusShareCardElement(
                focus.node ?? shareCardHeadingNode(current.scope),
                () => shareCardPresentationFocus(root, current.serial).current
              )
          }}
        />
      )}
    </PresentationRoot.Provider>
  )
}
