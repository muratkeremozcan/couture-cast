'use client'
// TEA sign-off N-1: the signup page's own copy, in the browser's language like the form beside it.
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getFederatedSignInStrings } from '@couture/utils'
import { getI18n } from '../../i18n'
import { LegalLinks } from '../components/legal-page'

export function SignupIntro() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  return (
    <section className="max-w-xl space-y-5">
      <p className="text-xs uppercase tracking-[0.4em] text-amber-300">
        {strings.signupEyebrow}
      </p>
      <h1 className="text-4xl font-semibold leading-tight">{strings.signupHeading}</h1>
      <p className="text-base text-neutral-300">{strings.signupIntro}</p>
      <Link
        href="/"
        className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm uppercase tracking-[0.24em] text-neutral-200 transition hover:border-amber-300 hover:text-amber-200"
      >
        {strings.backHome}
      </Link>
      <LegalLinks className="text-neutral-300" />
    </section>
  )
}
