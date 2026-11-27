'use client'
// Story 6.16 D8, D9: what can be saved, what stays in the preview, and the way into the
// real product. Both links carry only the literal `from=preview`.
import Link from 'next/link'
import type { GuestPreviewStrings } from '@couture/utils'

export function GuestPreviewConversion({
  strings,
  offline,
  onCreateAccount,
  onSignIn,
}: {
  strings: GuestPreviewStrings
  offline: boolean
  onCreateAccount: () => void
  onSignIn: () => void
}) {
  const detail = strings.conversionDetail
  return (
    <section
      aria-labelledby="guest-preview-conversion-heading"
      data-testid="guest-preview-conversion"
      data-surface="card"
      className="min-w-0 space-y-4 rounded-xl border border-line bg-card p-3 hyphens-auto [overflow-wrap:anywhere] min-[361px]:p-5"
    >
      <h2 id="guest-preview-conversion-heading" className="text-lg font-semibold">
        {detail.garmentHeading}
      </h2>
      <p className="text-sm text-ink">{strings.chrome.conversion}</p>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-semibold text-ink">{detail.canSave}</dt>
          <dd className="text-ink-soft">{detail.canSaveBody}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">{detail.previewOnly}</dt>
          <dd className="text-ink-soft">{detail.previewOnlyBody}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">{detail.stillRequired}</dt>
          <dd className="text-ink-soft">{detail.stillRequiredBody}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup?from=preview"
          onClick={onCreateAccount}
          data-testid="guest-preview-create-account"
          className="inline-flex min-h-11 items-center rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
        >
          {strings.chrome.createAccount}
        </Link>
        <Link
          href="/signin?from=preview"
          onClick={onSignIn}
          data-testid="guest-preview-sign-in"
          className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
        >
          {strings.chrome.signIn}
        </Link>
      </div>
      {offline ? (
        <p
          role="status"
          data-testid="guest-preview-offline"
          className="text-sm text-danger-ink"
        >
          {strings.chrome.connectionNeeded}
        </p>
      ) : null}
    </section>
  )
}
