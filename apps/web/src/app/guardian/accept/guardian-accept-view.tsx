'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GuardianInvitationAcceptInput,
  GuardianInvitationAcceptResponse,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
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
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleAccept() {
    if (!initialToken) {
      setErrorMessage(t('guardian.accept.tokenMissing'))
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const response = await acceptInvitation({ token: initialToken })
      setSuccessMessage(
        t('guardian.accept.success', {
          teenEmail: response.teenEmail,
          guardianEmail: response.guardianEmail,
        })
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('guardian.accept.failed')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // Story CC-7.9 D6, D7: the one card on the page; the top bar shows "Guardian consent" and
    // owns the only h1, so the eyebrow is gone and the heading is an h2.
    <section
      data-surface="card"
      className="mx-auto w-full max-w-2xl space-y-6 rounded-xl border border-line bg-card p-8"
    >
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold text-ink">
          {t('guardian.accept.heading')}
        </h2>
        <p className="text-sm leading-6 text-ink-soft">{t('guardian.accept.intro')}</p>
      </div>

      {errorMessage ? (
        <p
          data-testid="guardian-accept-error"
          className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger-ink"
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          data-testid="guardian-accept-success"
          className="rounded-lg border border-line px-4 py-3 text-sm text-success-ink"
          aria-live="polite"
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
        data-gold="primary"
        className="rounded-full bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? t('guardian.accept.accepting') : t('guardian.accept.accept')}
      </button>
    </section>
  )
}
