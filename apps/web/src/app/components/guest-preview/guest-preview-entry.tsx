'use client'
import Link from 'next/link'
import { useSyncExternalStore } from 'react'
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
      data-testid="today-first-content"
      aria-labelledby="home-sample-heading"
      data-surface="card"
      className="min-w-0 space-y-3 rounded-xl border border-line bg-card p-3 min-[361px]:p-5"
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
          className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-full bg-primary px-2 py-2 text-sm font-semibold text-on-primary min-[361px]:px-5"
        >
          <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere]">
            {strings.firstUse.sampleEntry}
          </span>
        </Link>
        <Link
          href="/signup"
          data-testid="landing-sign-up"
          data-landing="guest"
          className="inline-flex min-h-11 min-w-0 max-w-full items-center text-sm font-semibold text-ink underline underline-offset-4"
          data-ph-event="cta_clicked"
          data-ph-cta-label="Start signup"
          data-ph-cta-type="secondary"
        >
          <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere]">
            {strings.chrome.createAccount}
          </span>
        </Link>
        <Link
          href="/signin"
          data-testid="landing-sign-in"
          data-landing="guest"
          className="inline-flex min-h-11 min-w-0 max-w-full items-center text-sm font-semibold text-ink underline underline-offset-4"
        >
          <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere]">
            {strings.chrome.signIn}
          </span>
        </Link>
      </div>
    </section>
  )
}

const noSubscription = () => () => undefined

/**
 * False in the server HTML and through hydration, true once React owns the page. The head
 * script shows the member actions from first paint (lib/landing-session.ts), before the
 * bundle has hydrated them, and a tap on the server-rendered Sign out then does nothing: CI
 * real-session L-4 on webkit (fd692390, 40ee2f90) clicked it while hydrating and the page stayed
 * signed in, with the member ritual and community actions still rendered.
 */
function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )
}

export function ProfileSignOut() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  const hydrated = useHydrated()
  return (
    <button
      type="button"
      data-testid="profile-sign-out"
      data-landing="sign-out"
      disabled={!hydrated}
      onClick={() => void signOutWebSession().catch(() => undefined)}
      className="inline-flex min-h-11 items-center py-3 text-sm font-semibold text-ink underline underline-offset-4"
    >
      {strings.chrome.signOut}
    </button>
  )
}
