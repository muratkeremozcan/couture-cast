// Story 6.16: route shim for the guest preview; the screen lives in src/features/preview.
import { useEffect } from 'react'
import { useNavigation } from 'expo-router'
import { GuestPreviewScreen } from '@/src/features/preview/guest-preview-screen'
import { mobileGuestPreviewBirthdate } from '@/src/lib/guest-preview-birthdate'

export default function GuestPreviewRoute() {
  const navigation = useNavigation()
  useEffect(
    () => navigation.addListener('beforeRemove', mobileGuestPreviewBirthdate.clear),
    [navigation]
  )
  return <GuestPreviewScreen />
}
