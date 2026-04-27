import Link from 'next/link'
import { TeenDashboardView } from './teen-dashboard-view'

export default function TeenDashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-black to-neutral-900 px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <Link
          href="/"
          className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm uppercase tracking-[0.24em] text-neutral-200 transition hover:border-amber-300 hover:text-amber-200"
        >
          Back home
        </Link>
        <TeenDashboardView />
      </div>
    </main>
  )
}
