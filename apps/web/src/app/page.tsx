import { AnalyticsEventActions } from './components/analytics-event-actions'
import { PostHogClickTracker } from './components/posthog-click-tracker'
import {
  GuestPreviewEntry,
  MemberWardrobeActions,
} from './components/guest-preview/guest-preview-entry'
import { LegalLinks } from './components/legal-page'
import { LookbookPrismLayout } from './components/lookbook-prism-layout'
import { ProfileNavLink } from './components/profile-nav-link'
import { StickyBottomNav } from './components/sticky-bottom-nav'

const navLinks = [
  { href: '#ritual', label: 'Daily ritual', testId: 'nav-ritual' },
  { href: '#wardrobe', label: 'Wardrobe', testId: 'nav-wardrobe' },
  { href: '#community', label: 'Community', testId: 'nav-community' },
]

export default function Home() {
  return (
    // overflow-x-clip keeps the bleed layout from scrolling sideways without making this wrapper a
    // scroll container: overflow-x-hidden did, so the sticky chip bar and filter nav stuck to it
    // and scrolled off the screen with the page.
    <div
      data-focus-surface="dark"
      className="min-h-screen overflow-x-clip bg-gradient-to-b from-neutral-950 via-black to-neutral-900 text-white font-[family-name:var(--font-geist-sans)]"
    >
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
          className="flex w-full flex-wrap gap-x-4 gap-y-2 pb-1 text-xs uppercase sm:w-auto sm:gap-6 sm:text-sm sm:tracking-wide"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="whitespace-nowrap hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
              data-testid={link.testId}
              data-ph-event="nav_link_clicked"
              data-ph-label={link.label}
              data-ph-href={link.href}
            >
              {link.label}
            </a>
          ))}
          {/* 2026-11-19: on a wide screen the bottom nav is hidden, so this is where a member
              finds their profile (Jade looked for one and found nothing). */}
          <ProfileNavLink className="whitespace-nowrap hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" />
        </nav>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="max-w-6xl mx-auto flex flex-col gap-16 px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] outline-none"
      >
        <GuestPreviewEntry />
        {/* Margins bleed to the viewport edge. A -50% transform lands on a half pixel at odd widths
            and blends the dark page into column 0. */}
        <div className="relative mx-[calc(50%-min(50vw,720px))] w-[min(100vw,1440px)]">
          <LookbookPrismLayout />
        </div>
        <StickyBottomNav />

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
          {/* TEA P3: one gap for the whole stack of landing actions, sign-in and analytics alike. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4" data-landing="member">
              <MemberWardrobeActions />
            </div>
            <AnalyticsEventActions />
          </div>
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
        <LegalLinks className="text-neutral-300" />
      </main>
      <PostHogClickTracker />
    </div>
  )
}
