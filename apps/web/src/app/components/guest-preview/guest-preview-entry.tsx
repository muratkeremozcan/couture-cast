'use client'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { signOutWebSession } from '../../../lib/web-session'

export function GuestPreviewEntry() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  return (
    <section
      data-landing="guest"
      aria-labelledby="home-sample-heading"
      className="space-y-3 rounded-lg border border-amber-300/30 bg-neutral-900 p-5"
    >
      <h2 id="home-sample-heading" className="text-2xl font-semibold">
        {strings.outfit.heading}
      </h2>
      <p className="max-w-prose text-sm text-neutral-300">{strings.chrome.sampleLabel}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/preview"
          data-testid="guest-preview-entry"
          data-landing="guest"
          className="inline-flex min-h-11 items-center rounded-full bg-amber-300 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-200"
        >
          {strings.chrome.entry}
        </Link>
        <Link
          href="/signup"
          data-testid="landing-sign-up"
          data-landing="guest"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-neutral-200 underline underline-offset-4 hover:text-amber-200"
          data-ph-event="cta_clicked"
          data-ph-cta-label="Start signup"
          data-ph-cta-type="secondary"
        >
          Start signup
        </Link>
        <Link
          href="/signin"
          data-testid="landing-sign-in"
          data-landing="guest"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-neutral-200 underline underline-offset-4 hover:text-amber-200"
        >
          {strings.chrome.signIn}
        </Link>
      </div>
    </section>
  )
}

// The document's pre-paint session marker also keeps member actions out of the guest UI.
export function MemberWardrobeActions() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  return (
    <>
      <Link
        href="/wardrobe"
        data-testid="landing-open-wardrobe"
        data-landing="member"
        className="inline-flex min-h-11 items-center rounded-full bg-amber-300 px-5 py-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-black transition hover:bg-amber-200"
      >
        {strings.chrome.openWardrobe}
      </Link>
      <button
        type="button"
        data-testid="landing-sign-out"
        data-landing="member"
        onClick={() => void signOutWebSession().catch(() => undefined)}
        className="inline-flex min-h-11 items-center rounded-full px-0 py-3 sm:px-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-neutral-200 underline underline-offset-4 hover:text-amber-200"
      >
        {strings.chrome.signOut}
      </button>
    </>
  )
}
