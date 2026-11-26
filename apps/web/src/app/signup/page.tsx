import { parsePreviewFrom } from '@couture/utils'
import { AppPage, APP_MAIN_CLASS } from '../components/app-page'
import { SignupForm } from './signup-form'
import { SignupIntro, SignupTopBar } from './signup-intro'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { from, google } = await searchParams
  const fromPreview = parsePreviewFrom(from) !== null
  // Story 6.17 D5: only the three fixed outcome names; anything else shows nothing.
  const googleOutcome =
    google === 'cancelled' || google === 'unavailable' || google === 'refused'
      ? google
      : null
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; the always-dark gradient is gone.
    <AppPage>
      <SignupTopBar />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 lg:flex-row lg:items-start">
          <SignupIntro />

          <div className="w-full max-w-lg">
            <SignupForm fromPreview={fromPreview} googleOutcome={googleOutcome} />
          </div>
        </div>
      </main>
    </AppPage>
  )
}
