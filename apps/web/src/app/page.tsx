import Link from 'next/link'
import { AnalyticsEventActions } from './components/analytics-event-actions'
import { PostHogClickTracker } from './components/posthog-click-tracker'
import { LookbookPrismLayout } from './components/lookbook-prism-layout'

const navLinks = [
  { href: '#ritual', label: 'Daily ritual', testId: 'nav-ritual' },
  { href: '#wardrobe', label: 'Wardrobe', testId: 'nav-wardrobe' },
  { href: '#community', label: 'Community', testId: 'nav-community' },
]

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-neutral-950 via-black to-neutral-900 text-white font-[family-name:var(--font-geist-sans)]">
      <header className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-6 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-2">
          <p
            data-testid="app-badge"
            className="uppercase text-xs tracking-[0.3em] text-neutral-400"
          >
            CoutureCast
          </p>
          <p className="text-sm text-neutral-400">
            Weather-aware wardrobe plans for every commute
          </p>
        </div>
        <nav
          aria-label="Primary"
          data-testid="primary-nav"
          className="flex w-full gap-4 overflow-x-auto pb-1 text-sm uppercase tracking-wide sm:w-auto sm:gap-6"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
              data-testid={link.testId}
              data-ph-event="nav_link_clicked"
              data-ph-label={link.label}
              data-ph-href={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto space-y-16 px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="relative left-1/2 w-[100vw] max-w-[1440px] -translate-x-1/2">
          <LookbookPrismLayout />
        </div>

        <section id="ritual" data-testid="hero-section" className="space-y-6">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-300">
            Daily ritual
          </p>
          <h1
            data-testid="hero-headline"
            className="text-4xl sm:text-5xl font-semibold leading-tight"
          >
            Plan confident outfits in under 90 seconds.
          </h1>
          <p className="text-lg text-neutral-300 max-w-2xl">
            CoutureCast blends hyperlocal weather, your wardrobe archive, and community
            insight to recommend looks that respect the commute, the meeting, and the
            vibe.
          </p>
          <div>
            <Link
              href="/signup"
              className="inline-flex rounded-full border border-amber-300 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-amber-200 transition hover:bg-amber-300 hover:text-black"
              data-ph-event="cta_clicked"
              data-ph-cta-label="Start signup"
              data-ph-cta-type="primary"
            >
              Start signup
            </Link>
          </div>
          <AnalyticsEventActions />
        </section>

        <section
          id="health"
          aria-live="polite"
          data-testid="health-indicator"
          className="border border-white/10 rounded-2xl p-6 flex flex-col gap-2 bg-white/5"
        >
          <p className="text-xs uppercase tracking-[0.4em] text-neutral-400">Systems</p>
          <p className="text-lg font-semibold">
            All personalization services reporting healthy.
          </p>
          <p className="text-sm text-neutral-400">
            Weather ingestion, outfit recommendations, and wardrobe syncs are monitored
            24/7 with automated fallbacks.
          </p>
        </section>
      </main>
      <PostHogClickTracker />
    </div>
  )
}
