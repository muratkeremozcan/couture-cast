import type { Metadata } from 'next'
import { AppPage, APP_MAIN_CLASS } from '../../../components/app-page'
import { AppTopBar } from '../../../components/app-top-bar'
import { ModerationCaseDetailView } from '../../../components/moderation-case-detail'

export const metadata: Metadata = { title: 'CoutureCast moderation case' }

/** A malformed escape keeps the raw segment, which the API answers with 404 `case_not_found`. */
function readCaseId(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

type ModerationCasePageProps = { params: Promise<{ caseId: string }> }

export default async function ModerationCasePage({ params }: ModerationCasePageProps) {
  const { caseId } = await params
  return (
    // Story CC-7.9 D6, D7: the shared top bar and page surface; staff wording stays as it is (D9).
    <AppPage>
      <AppTopBar titleKey="moderation.detail.screenTitle" backHref="/moderation" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <ModerationCaseDetailView caseId={readCaseId(caseId)} />
      </main>
    </AppPage>
  )
}
