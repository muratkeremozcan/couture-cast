import { GuardianAcceptView } from './guardian-accept-view'

type GuardianAcceptPageProps = {
  searchParams?: Promise<{
    token?: string | string[]
  }>
}

export default async function GuardianAcceptPage({
  searchParams,
}: GuardianAcceptPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const token = Array.isArray(resolvedSearchParams.token)
    ? resolvedSearchParams.token[0]
    : resolvedSearchParams.token

  return <GuardianAcceptView initialToken={token ?? null} />
}
