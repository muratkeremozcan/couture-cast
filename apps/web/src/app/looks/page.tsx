// Story CC-7.11 D8 owner: the Looks tab route. The screen lives in `components/looks-screen.tsx`,
// since Next types every file under `app/` as a route.
'use client'

import { LooksScreen } from '../components/looks-screen'

export default function LooksPage() {
  return <LooksScreen />
}
