import { AppPage, APP_MAIN_CLASS } from './components/app-page'
import { AppTopBar } from './components/app-top-bar'
import { HomeBrandLine, HomeHero } from './components/home-hero'
import { PostHogClickTracker } from './components/posthog-click-tracker'
import { GuestPreviewEntry } from './components/guest-preview/guest-preview-entry'
import { LegalLinks } from './components/legal-page'
import { LookbookPrismLayout } from './components/lookbook-prism-layout'
import { ScreenGate } from './components/screen-gate'
import { StickyBottomNav } from './components/sticky-bottom-nav'

export default function Home() {
  return (
    // Story CC-7.9 D7: one page surface. The dark gradient frame and the light inset lookbook
    // card are gone; the lookbook sections sit straight on the page. overflow-x-clip keeps a wide
    // section from scrolling sideways without making this a scroll container (the sticky chip
    // bar and filter nav would stick to it otherwise).
    <AppPage className="overflow-x-clip">
      {/* D6/D8: the top bar renders outside the gate, so the placeholder sits inside the shell. */}
      <AppTopBar titleKey="nav.home" />
      <main id="main-content" tabIndex={-1} className={`${APP_MAIN_CLASS} gap-16`}>
        {/* The brand line keeps the small gap the old page header gave it. On the main gap-16
            a member, whose tagline is hidden, saw 64 px of blank page above Plan week. */}
        <div className="flex flex-col gap-4">
          <HomeBrandLine />
          {/* Story CC-7.7 D3: the body appears once the member's outfit (the ritual read with
              its city line), the Spotlight teaser in the hero, the City Spotlight above the feed
              and any deep link above the grid have answered; the feed is the last section and
              fills in below them. */}
          <ScreenGate
            screen="home"
            reads={HOME_GATE_READS}
            placeholderClassName={HOME_PLACEHOLDER_CLASS}
          >
            <div className="flex flex-col gap-16">
              <GuestPreviewEntry />
              <LookbookPrismLayout />
            </div>
          </ScreenGate>
        </div>
        {/* The hero reads nothing, and its landing actions follow <html data-session> from first
            paint, so it stays outside the gate: a pending session shows the hero with neither
            set of actions while it is verified (real-session L-10), instead of a hidden body that
            a verification timeout later reveals as the signed-out landing. The placeholder
            fills the viewport, so the body appearing above it moves nothing on screen. */}
        <HomeHero />
        <LegalLinks />
      </main>
      <StickyBottomNav />
      <PostHogClickTracker />
    </AppPage>
  )
}

const HOME_GATE_READS = ['ritual', 'teaser', 'spotlight', 'deeplink'] as const
const HOME_PLACEHOLDER_CLASS = 'min-h-screen w-full rounded-xl bg-card-muted'
