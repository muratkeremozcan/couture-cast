import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
import { GuardianDashboardView } from './guardian-dashboard-view'

export default function GuardianDashboardPage() {
  return (
    // Story CC-7.9 D6, D7: the shared top bar (its back control replaces the old "Back home"
    // link) on the page surface; the always-dark gradient is gone.
    <AppPage>
      <AppTopBar titleKey="guardian.dashboard.title" parentHref="/settings" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <div className="mx-auto w-full max-w-5xl">
          <GuardianDashboardView />
        </div>
      </main>
    </AppPage>
  )
}
