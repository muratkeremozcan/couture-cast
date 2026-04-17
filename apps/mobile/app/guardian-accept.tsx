import { useLocalSearchParams } from 'expo-router'
import { GuardianAcceptScreen } from '@/src/features/guardian/guardian-accept-screen'

export default function GuardianAcceptRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>()
  const token = Array.isArray(params.token) ? params.token[0] : params.token

  return <GuardianAcceptScreen token={token ?? null} />
}
