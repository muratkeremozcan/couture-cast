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

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="min-h-screen bg-neutral-950 outline-none"
    >
      <GuardianAcceptView initialToken={token ?? null} />
    </main>
  )
}
