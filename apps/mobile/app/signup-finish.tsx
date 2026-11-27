// Story 6.17 D3: route for the Google finish step.
import { useCallback, useEffect, useRef, useState } from 'react'
import { router, useLocalSearchParams, useNavigation, type Href } from 'expo-router'
import {
  GUEST_PREVIEW_SAVE_INTENT,
  parsePreviewFrom,
  parseSignInDoor,
  signInDoorHref,
} from '@couture/utils'
import { FinishSignupScreen } from '@/src/features/signup/finish-signup-screen'
import { mobileGuestPreviewStore } from '@/src/lib/guest-preview-store'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

export default function SignupFinishRoute() {
  const { from, door } = useLocalSearchParams<{ from?: string; door?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  const [savingGuestLook, setSavingGuestLook] = useState(false)
  useEffect(() => {
    if (!fromPreview) return
    let active = true
    void mobileGuestPreviewStore()
      .load()
      .then(({ state }) => {
        if (active)
          setSavingGuestLook(state?.conversion?.intent === GUEST_PREVIEW_SAVE_INTENT)
      })
    return () => {
      active = false
    }
  }, [fromPreview])
  // D5: Cancel and refusals return to the page that started the round trip.
  const doorHref = signInDoorHref(parseSignInDoor(door), { fromPreview }) as Href
  const navigation = useNavigation()
  const setTitle = useCallback(
    (title: string) => navigation.setOptions({ title }),
    [navigation]
  )
  const clearing = useRef<Promise<void>>(Promise.resolve())
  return (
    <FinishSignupScreen
      fromPreview={fromPreview}
      savingGuestLook={fromPreview && savingGuestLook}
      onTitleChange={setTitle}
      onUnderage={() => {
        // D3: an age refusal clears any guest preview stored on this device, whichever door
        // started, and the write lands before Continue leaves the screen.
        const store = mobileGuestPreviewStore()
        store.clear()
        clearing.current = store.flush().catch(() => undefined)
      }}
      onExit={(exit) => {
        if (exit === 'continue') {
          void continuesToPreviewReview(fromPreview).then((review) =>
            router.replace(review ? '/preview-continue' : '/')
          )
          return
        }
        if (exit === 'cancelled' && fromPreview && savingGuestLook)
          router.dismissTo('/preview')
        else if (exit === 'home') void clearing.current.then(() => router.replace('/'))
        else if (exit === 'until_approved')
          // Every signed-in request refuses the teen until a guardian approves.
          void import('../src/lib/native-session.js')
            .then((session) => session.signOutNativeSession())
            .catch(() => undefined)
            .then(() => router.replace('/'))
        else router.replace(doorHref)
      }}
    />
  )
}
