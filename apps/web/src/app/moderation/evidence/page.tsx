import type { Metadata } from 'next'
import { ModerationEvidenceRange } from '../../components/moderation-evidence-export'

export const metadata: Metadata = { title: 'CoutureCast moderation evidence' }

export default function ModerationEvidencePage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-white px-4 py-8 text-neutral-900 outline-none sm:px-6 sm:py-12 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <ModerationEvidenceRange />
    </main>
  )
}
