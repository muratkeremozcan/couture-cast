'use client'
// Story 6.16 D1: the landing's way into the labeled guest preview, beside signup.
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import { getI18n } from '../../../i18n'

export function GuestPreviewEntry() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  return (
    <>
      <Link
        href="/preview"
        data-testid="guest-preview-entry"
        className="inline-flex min-h-11 items-center rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-black transition hover:bg-amber-200"
      >
        {strings.chrome.entry}
      </Link>
      <Link
        href="/signin"
        data-testid="landing-sign-in"
        className="inline-flex min-h-11 items-center rounded-full px-3 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-neutral-200 underline underline-offset-4 hover:text-amber-200"
      >
        {strings.chrome.signIn}
      </Link>
    </>
  )
}
