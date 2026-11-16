'use client'
// Story 6.16 D1: the landing's way into the labeled guest preview, beside signup.
// Owner report 2026-11-16: a signed-in member saw these signed-out actions and ran Google
// sign-in again. Each set carries data-landing, and globals.css shows only the set that matches
// <html data-session> (lib/landing-session.ts), from first paint.
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { signOutWebSession } from '../../../lib/web-session'

export function GuestPreviewEntry() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  return (
    <>
      <Link
        href="/preview"
        data-testid="guest-preview-entry"
        data-landing="guest"
        className="inline-flex min-h-11 items-center rounded-full bg-amber-300 px-5 py-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-black transition hover:bg-amber-200"
      >
        {strings.chrome.entry}
      </Link>
      <Link
        href="/signin"
        data-testid="landing-sign-in"
        data-landing="guest"
        className="inline-flex min-h-11 items-center rounded-full px-3 py-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-neutral-200 underline underline-offset-4 hover:text-amber-200"
      >
        {strings.chrome.signIn}
      </Link>
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
        className="inline-flex min-h-11 items-center rounded-full px-3 py-3 whitespace-nowrap text-sm font-semibold sm:uppercase sm:tracking-[0.24em] text-neutral-200 underline underline-offset-4 hover:text-amber-200"
      >
        {strings.chrome.signOut}
      </button>
    </>
  )
}
