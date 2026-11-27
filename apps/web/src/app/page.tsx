import { AnalyticsEventActions } from './components/analytics-event-actions'
import { AppPage, APP_MAIN_NARROW_CLASS } from './components/app-page'
import { AppTopBar } from './components/app-top-bar'
import { PostHogClickTracker } from './components/posthog-click-tracker'
import { LegalLinks } from './components/legal-page'
import { LookbookPrismLayout } from './components/lookbook-prism-layout'
import { ScreenGate } from './components/screen-gate'
import { StickyBottomNav } from './components/sticky-bottom-nav'

export default function Home() {
  return (
    <AppPage className="overflow-x-clip">
      <AppTopBar titleKey="nav.today" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
        <ScreenGate
          screen="home"
          reads={HOME_GATE_READS}
          placeholderClassName="min-h-screen w-full rounded-xl bg-card-muted"
        >
          <LookbookPrismLayout />
        </ScreenGate>
        <div data-landing="guest">
          <LegalLinks />
        </div>
      </main>
      <StickyBottomNav />
      <AnalyticsEventActions pollOnly />
      <PostHogClickTracker />
    </AppPage>
  )
}

const HOME_GATE_READS = ['ritual', 'closet', 'teaser', 'deeplink'] as const
