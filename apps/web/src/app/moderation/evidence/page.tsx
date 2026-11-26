import type { Metadata } from 'next'
import { AppPage, APP_MAIN_CLASS } from '../../components/app-page'
import { AppTopBar } from '../../components/app-top-bar'
import { ModerationEvidenceRange } from '../../components/moderation-evidence-export'

export const metadata: Metadata = { title: 'CoutureCast moderation evidence' }

export default function ModerationEvidencePage() {
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; staff wording stays as it is (D9).
    <AppPage>
      <AppTopBar titleKey="moderation.evidence.title" backHref="/moderation" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <ModerationEvidenceRange />
      </main>
    </AppPage>
  )
}
