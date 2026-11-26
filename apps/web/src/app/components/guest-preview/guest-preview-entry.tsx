'use client'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { createMemberSampleOutfit, getGuestPreviewStrings } from '@couture/utils'
import { SampleGarmentArt } from './sample-garment-art'
import { getI18n } from '../../../i18n'
import { signOutWebSession } from '../../../lib/web-session'

export function GuestPreviewEntry() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  return (
    <section
      data-landing="guest"
      aria-labelledby="home-sample-heading"
      data-surface="card"
      className="space-y-3 rounded-xl border border-line bg-card p-5"
    >
      <h2 id="home-sample-heading" className="text-2xl font-semibold">
        {strings.firstUse.outfitIdea}
      </h2>
      <p className="max-w-prose text-sm text-ink-soft">{strings.chrome.sampleLabel}</p>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {createMemberSampleOutfit().garments.map((garment) => (
          <span key={garment.id} className="rounded-md bg-page p-1">
            <SampleGarmentArt garment={garment} className="h-12 w-12" />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/preview"
          data-testid="guest-preview-entry"
          data-landing="guest"
          // Story CC-7.9 D3: a guest's one main action on Home.
          data-gold="primary"
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary"
        >
          {strings.firstUse.sampleEntry}
        </Link>
        <Link
          href="/signup"
          data-testid="landing-sign-up"
          data-landing="guest"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4"
          data-ph-event="cta_clicked"
          data-ph-cta-label="Start signup"
          data-ph-cta-type="secondary"
        >
          {strings.chrome.createAccount}
        </Link>
        <Link
          href="/signin"
          data-testid="landing-sign-in"
          data-landing="guest"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4"
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
        // Story CC-7.9 D3: a member's one main action on Home.
        data-gold="primary"
        className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-on-primary"
      >
        {strings.chrome.openWardrobe}
      </Link>
      <button
        type="button"
        data-testid="landing-sign-out"
        data-landing="member"
        onClick={() => void signOutWebSession().catch(() => undefined)}
        className="inline-flex min-h-11 items-center rounded-full px-0 py-3 sm:px-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-ink underline underline-offset-4"
      >
        {strings.chrome.signOut}
      </button>
    </>
  )
}
