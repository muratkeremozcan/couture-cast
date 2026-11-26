import type { Metadata } from 'next'
import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
import { ModerationSlaDashboard } from '../../components/moderation-sla-dashboard'

export const metadata: Metadata = { title: 'CoutureCast moderation SLA' }

export default function ModerationSlaPage() {
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; staff wording stays as it is (D9).
    <AppPage>
      <AppTopBar titleKey="moderation.sla.title" parentHref="/moderation" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <ModerationSlaDashboard />
      </main>
    </AppPage>
  )
}
