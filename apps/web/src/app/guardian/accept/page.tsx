'use client'

import { useSearchParams } from 'next/navigation'
import { GuardianAcceptView } from './guardian-accept-view'

export default function GuardianAcceptPage() {
  const searchParams = useSearchParams()

  return <GuardianAcceptView initialToken={searchParams.get('token')} />
}
