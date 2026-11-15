import Link from 'next/link'
import type { ReactNode } from 'react'

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
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="min-h-screen bg-gradient-to-b from-neutral-950 via-black to-neutral-900 px-6 py-16 text-white outline-none"
    >
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-300">CoutureCast</p>
          <h1 className="text-4xl font-semibold leading-tight">{title}</h1>
          <p className="text-base text-neutral-300">{summary}</p>
          <p className="text-sm text-neutral-400">
            Last updated <time dateTime={LEGAL_UPDATED_ON}>November 15, 2026</time>
          </p>
        </header>
        <div className="space-y-10 text-base leading-relaxed text-neutral-200">
          {children}
        </div>
        <LegalLinks home className="border-t border-white/10 pt-6" />
      </article>
    </main>
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
      <h2 id={headingId} className="text-2xl font-semibold text-white">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-amber-300">{children}</ul>
}

export function ContactLink() {
  return (
    <a
      href={`mailto:${LEGAL_CONTACT_EMAIL}`}
      className="text-amber-200 underline underline-offset-4 hover:text-amber-100"
    >
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}

// Inherits the host page's text color: the links sit on dark pages and on the light sign-in page.
const linkClass =
  'inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300'

/**
 * The legal links every public entry point shows: the home page, signup, sign-in and the
 * finish step. Google's consent screen links to the same two pages.
 */
export function LegalLinks({
  home = false,
  className = '',
}: {
  home?: boolean
  className?: string
}) {
  return (
    <nav
      aria-label="Legal"
      className={`flex flex-wrap gap-x-6 gap-y-2 text-sm ${className}`}
    >
      {home ? (
        <Link href="/" className={linkClass}>
          Home
        </Link>
      ) : null}
      <Link href="/privacy" className={linkClass}>
        Privacy Policy
      </Link>
      <Link href="/terms" className={linkClass}>
        Terms of Service
      </Link>
    </nav>
  )
}
