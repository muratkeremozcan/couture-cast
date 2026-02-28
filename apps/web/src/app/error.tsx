'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    posthog.capture('error_page_viewed', {
      error_name: error.name,
      error_digest: error.digest ?? 'none',
    })
  }, [error.digest, error.name])

  const handleReset = () => {
    posthog.capture('error_reset_clicked', {
      error_name: error.name,
      error_digest: error.digest ?? 'none',
    })
    reset()
  }

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <h1 className="text-3xl font-semibold">Something went wrong</h1>
        <p className="text-base opacity-75">{error.message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-white px-4 py-2 text-sm uppercase"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded border border-white px-4 py-2 text-sm uppercase"
          >
            Go home
          </Link>
        </div>
      </body>
    </html>
  )
}
