'use client'

import { useState } from 'react'
import type {
  GuardianInvitationAcceptInput,
  GuardianInvitationAcceptResponse,
} from '@couture/api-client/contracts/http'
import { acceptGuardianInvitationFromWeb } from '../../../lib/guardian'

type GuardianAcceptViewProps = {
  initialToken?: string | null
  acceptInvitation?: (
    input: GuardianInvitationAcceptInput
  ) => Promise<GuardianInvitationAcceptResponse>
}

export function GuardianAcceptView({
  initialToken,
  acceptInvitation = acceptGuardianInvitationFromWeb,
}: GuardianAcceptViewProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleAccept() {
    if (!initialToken) {
      setErrorMessage('Invitation token is missing from this link.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const response = await acceptInvitation({ token: initialToken })
      setSuccessMessage(
        `Consent recorded for ${response.teenEmail}. Guardian account ${response.guardianEmail} is now linked.`
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to accept guardian invitation'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6 rounded-[2rem] border border-white/10 bg-white/5 p-8">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200">
          Guardian consent
        </p>
        <h1 className="text-3xl font-semibold text-white">Accept teen wardrobe access</h1>
        <p className="text-sm leading-6 text-neutral-300">
          Confirm this invitation to link the guardian account and unlock the teen
          wardrobe journey.
        </p>
      </div>

      {errorMessage ? (
        <p
          data-testid="guardian-accept-error"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          data-testid="guardian-accept-success"
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {successMessage}
        </p>
      ) : null}

      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => {
          void handleAccept()
        }}
        className="rounded-full bg-amber-300 px-6 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Accepting…' : 'Accept invitation'}
      </button>
    </section>
  )
}
