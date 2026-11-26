import { parsePreviewFrom, parseSignInDoor } from '@couture/utils'
import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { LegalLinks } from '../../components/legal-page'
import { FinishSignupForm, FinishSignupTopBar } from './finish-signup-form'

export default async function FinishSignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { from, door } = await searchParams
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; the always-dark gradient is gone.
    <AppPage>
      <FinishSignupTopBar />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
          <FinishSignupForm
            fromPreview={parsePreviewFrom(from) !== null}
            door={parseSignInDoor(typeof door === 'string' ? door : null)}
          />
          <LegalLinks />
        </div>
      </main>
    </AppPage>
  )
}
