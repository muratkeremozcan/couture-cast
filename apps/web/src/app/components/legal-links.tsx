// Story CC-7.9 P2-11 owner: the shared legal navigation reads its labels from the web catalogs.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

// Story CC-7.9: every host page sits on the page surface now, so the links carry their own role.
const linkClass =
  'inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80'

/**
 * The legal links every public entry point shows: the home page, signup, sign-in and the
 * finish step. Google's consent screen links to the same two pages.
 *
 * A client component like the top bar: the server render (and a reader without JavaScript)
 * gets the en-US labels, and the browser's language takes over once the app mounts. Only the
 * navigation is localized; the legal documents stay English (spec 6.17 D12).
 */
export function LegalLinks({
  home = false,
  className = '',
}: {
  home?: boolean
  className?: string
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <nav
      aria-label={t('shell.legal.label')}
      className={`flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft ${className}`}
    >
      {home ? (
        <Link href="/" className={linkClass}>
          {t('nav.home')}
        </Link>
      ) : null}
      <Link href="/privacy" className={linkClass}>
        {t('shell.legal.privacy')}
      </Link>
      <Link href="/terms" className={linkClass}>
        {t('shell.legal.terms')}
      </Link>
    </nav>
  )
}
