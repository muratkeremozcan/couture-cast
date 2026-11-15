import Link from 'next/link'
import { parsePreviewFrom } from '@couture/utils'
import { LegalLinks } from '../components/legal-page'
import { SignupForm } from './signup-form'

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
        <section className="max-w-xl space-y-5">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-300">
            COPPA-ready signup
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            Start with age verification before wardrobe access unlocks.
          </h1>
          <p className="text-base text-neutral-300">
            CoutureCast blocks accounts for children under 13 and routes users aged 13 to
            15 into a guardian consent flow before they can continue.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm uppercase tracking-[0.24em] text-neutral-200 transition hover:border-amber-300 hover:text-amber-200"
          >
            Back home
          </Link>
          <LegalLinks className="text-neutral-300" />
        </section>

        <div className="w-full max-w-lg">
          <SignupForm fromPreview={fromPreview} googleOutcome={googleOutcome} />
        </div>
      </div>
    </main>
  )
}
