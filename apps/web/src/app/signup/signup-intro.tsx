'use client'
// TEA sign-off N-1: the signup page's own copy, in the browser's language like the form beside it.
import { useTranslation } from 'react-i18next'
import { getFederatedSignInStrings } from '@couture/utils'
import { getI18n } from '../../i18n'
import { AppTopBar } from '../components/app-top-bar'
import { LegalLinks } from '../components/legal-page'

/**
 * Story CC-7.9 D6: the signup top bar, titled in the browser's language. A client component, so
 * the server page can render it and the title re-renders when the language switches (N-1).
 */
export function SignupTopBar() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  return (
    <AppTopBar title={getFederatedSignInStrings(i18n.language).create} backHref="/" />
  )
}

export function SignupIntro() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  return (
    // The top bar owns the page's only h1 and its back control (D6), so this heading is an h2
    // and the old "Back home" link is gone.
    <section className="max-w-xl space-y-5">
      <p className="text-xs uppercase tracking-[0.4em] text-ink-muted">
        {strings.signupEyebrow}
      </p>
      <h2 className="text-3xl font-semibold leading-tight text-ink">
        {strings.signupHeading}
      </h2>
      <p className="text-base text-ink-soft">{strings.signupIntro}</p>
      <LegalLinks />
    </section>
  )
}
