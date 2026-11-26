// Story CC-7.12 D5 owner: a saved look's address. The screen lives in
// `components/looks/saved-look-detail-screen.tsx`, since Next types every file under `app/` as a
// route.
'use client'

import { useParams } from 'next/navigation'
import { SavedLookDetailScreen } from '../../../components/looks/saved-look-detail-screen'

/**
 * Codex #10: the segment as an id. A malformed escape (a literal `%`) never throws; the raw value
 * goes to the read, whose 400 or 404 shows the gone state with the back control.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default function SavedLookPage() {
  const params = useParams<{ savedLookId: string }>()
  const savedLookId = safeDecode(params?.savedLookId ?? '')
  return <SavedLookDetailScreen key={savedLookId} savedLookId={savedLookId} />
}
