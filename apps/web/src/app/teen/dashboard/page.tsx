import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
import { TeenDashboardView } from './teen-dashboard-view'

export default function TeenDashboardPage() {
  return (
    // Story CC-7.9 D6, D7: the shared top bar (its back control replaces the old "Back home"
    // link) on the page surface; the always-dark gradient is gone.
    <AppPage>
      <AppTopBar titleKey="teen.dashboard.title" backHref="/" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <div className="mx-auto w-full max-w-4xl">
          <TeenDashboardView />
        </div>
      </main>
    </AppPage>
  )
}
