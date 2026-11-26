import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
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
    // Story CC-7.9 D6, D7: the shared top bar and page surface; the always-dark page is gone.
    <AppPage>
      <AppTopBar titleKey="guardian.accept.title" backHref="/" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <GuardianAcceptView initialToken={token ?? null} />
      </main>
    </AppPage>
  )
}
