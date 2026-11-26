import type { Metadata } from 'next'
import { AppPage, APP_MAIN_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { ModerationQueueView } from '../components/moderation-queue'

export const metadata: Metadata = { title: 'CoutureCast moderation' }

export default function ModerationPage() {
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; staff wording stays as it is (D9).
    <AppPage>
      <AppTopBar titleKey="moderation.title" parentHref="/" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <ModerationQueueView />
      </main>
    </AppPage>
  )
}
