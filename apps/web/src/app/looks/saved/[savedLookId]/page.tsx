// Story CC-7.12 D5 owner: a saved look's address. The screen lives in
// `components/looks/saved-look-detail-screen.tsx`, since Next types every file under `app/` as a
// route.
'use client'

import { useParams } from 'next/navigation'
import { SavedLookDetailScreen } from '../../../components/looks/saved-look-detail-screen'

export default function SavedLookPage() {
  const params = useParams<{ savedLookId: string }>()
  const savedLookId = decodeURIComponent(params?.savedLookId ?? '')
  return <SavedLookDetailScreen key={savedLookId} savedLookId={savedLookId} />
}
