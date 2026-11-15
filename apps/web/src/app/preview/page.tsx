// Story 6.16 owner: the guest sample wardrobe and outfit preview route.
import { Suspense } from 'react'
import { GuestPreview } from '../components/guest-preview/guest-preview'

export default function PreviewPage() {
  // `useSearchParams` reads the surface from `?view=`, which needs a boundary.
  return (
    <Suspense fallback={null}>
      <GuestPreview />
    </Suspense>
  )
}
