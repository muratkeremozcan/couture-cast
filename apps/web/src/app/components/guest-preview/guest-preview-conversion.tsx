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
      className="space-y-4 rounded-[8px] border border-[#C9A14A] bg-[#FFFFFF] p-5"
    >
      <h2 id="guest-preview-conversion-heading" className="text-lg font-semibold">
        {detail.garmentHeading}
      </h2>
      <p className="text-sm text-[#111111]">{strings.chrome.conversion}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-semibold text-[#111111]">{detail.canSave}</dt>
          <dd className="text-[#36363D]">{detail.canSaveBody}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#111111]">{detail.previewOnly}</dt>
          <dd className="text-[#36363D]">{detail.previewOnlyBody}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#111111]">{detail.stillRequired}</dt>
          <dd className="text-[#36363D]">{detail.stillRequiredBody}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup?from=preview"
          onClick={onCreateAccount}
          data-testid="guest-preview-create-account"
          className="inline-flex min-h-11 items-center rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
        >
          {strings.chrome.createAccount}
        </Link>
        <Link
          href="/signin?from=preview"
          onClick={onSignIn}
          data-testid="guest-preview-sign-in"
          className="inline-flex min-h-11 items-center rounded-lg border border-[#111111] px-4 text-sm font-semibold text-[#111111]"
        >
          {strings.chrome.signIn}
        </Link>
      </div>
      {offline ? (
        <p
          role="status"
          data-testid="guest-preview-offline"
          className="text-sm text-[#9F1D1D]"
        >
          {strings.chrome.connectionNeeded}
        </p>
      ) : null}
    </section>
  )
}
