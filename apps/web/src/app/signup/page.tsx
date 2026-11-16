import { parsePreviewFrom } from '@couture/utils'
import { SignupForm } from './signup-form'
import { SignupIntro } from './signup-intro'

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
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="min-h-screen bg-gradient-to-b from-neutral-950 via-black to-neutral-900 px-6 py-16 text-white outline-none"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-8 lg:flex-row lg:items-start">
        <SignupIntro />

        <div className="w-full max-w-lg">
          <SignupForm fromPreview={fromPreview} googleOutcome={googleOutcome} />
        </div>
      </div>
    </main>
  )
}
