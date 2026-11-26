import type { ReactNode } from 'react'
import { AppPage, APP_MAIN_CLASS } from './app-page'
import { AppTopBar } from './app-top-bar'
import { LegalLinks } from './legal-links'

/**
 * Story 6.17: the shared frame for the public legal pages (/privacy, /terms).
 *
 * Server-rendered with no session check, so the pages load for anyone, without JavaScript,
 * from Google's consent screen links as well as from the app. English only (spec 6.17 D12).
 */
export const LEGAL_CONTACT_EMAIL = 'muratkerem@gmail.com'
export const LEGAL_UPDATED_ON = '2026-11-15'

export function LegalPage({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: ReactNode
}) {
  // Story CC-7.9 D6, D7: the shared top bar (the page title, back to Home) on the page surface;
  // the always-dark gradient frame is gone and the top bar owns the page's one h1.
  return (
    <AppPage>
      <AppTopBar title={title} backHref="/" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <article className="mx-auto w-full max-w-3xl space-y-10">
          <header className="space-y-4">
            <p className="text-xs uppercase tracking-[0.4em] text-ink-muted">
              CoutureCast
            </p>
            <p className="text-base text-ink-soft">{summary}</p>
            <p className="text-sm text-ink-muted">
              Last updated <time dateTime={LEGAL_UPDATED_ON}>November 15, 2026</time>
            </p>
          </header>
          <div className="space-y-10 text-base leading-relaxed text-ink-soft">
            {children}
          </div>
          <LegalLinks home className="border-t border-line pt-6" />
        </article>
      </main>
    </AppPage>
  )
}

/** A titled section; the heading names its region, so the sections show as page landmarks. */
export function LegalSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const headingId = `legal-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-2xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-ink-muted">{children}</ul>
}

export function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={LEGAL_INLINE_LINK_CLASS}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}

/** An inline link inside legal copy (the contact address, the other legal page). */
export const LEGAL_INLINE_LINK_CLASS =
  'font-medium text-ink underline underline-offset-4 hover:opacity-80'

// Story CC-7.9 P2-11: the links read the catalogs, so they live in a client component; the
// legal pages themselves stay server-rendered English.
export { LegalLinks }
