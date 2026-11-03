import type { Metadata } from 'next'
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
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-white px-4 py-8 text-neutral-900 outline-none sm:px-6 sm:py-12 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <ModerationCaseDetailView caseId={readCaseId(caseId)} />
    </main>
  )
}
