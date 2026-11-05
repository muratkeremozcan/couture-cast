'use client'

// Story 6.11 web owner: the author's standing and appeal steps in the case view.
// The steps come from the API. An appeal is recorded by an operator: members have no appeal form yet.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_REASON_MIN_LENGTH,
  type ModerationAppealStep,
} from '@couture/api-client/contracts/http'
import {
  createMutationIdKeeper,
  moderationDecisionFailure,
  recordModerationAppealFromWeb,
  useModerationTranslation,
  type ModerationCaseResult,
} from '../../lib/moderation'
import {
  DecisionFailureNotice,
  moderationCard,
  type DecisionFailureState,
} from './moderation-decision-panel'
import { moderationControl } from './moderation-failure-notice'

export function ModerationAccountStanding({
  detail,
  onApplied,
  onReload,
}: {
  detail: ModerationCaseResult
  onApplied: (message: string) => void
  onReload: () => void
}) {
  const { t, i18n } = useModerationTranslation()
  const standing = detail.subjectStanding
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<DecisionFailureState | null>(null)
  const [lastStep, setLastStep] = useState<ModerationAppealStep | null>(null)
  const inFlight = useRef(false)
  const failedReason = useRef<string | null>(null)
  const keeper = useMemo(() => createMutationIdKeeper(), [])
  // A new reading answers the old failure. The typed note stays.
  useEffect(() => {
    setFailure(null)
  }, [detail.revision, standing?.sanction?.appealStatus])
  if (!standing) return null
  const { sanction } = standing

  const trimmed = reason.trim()
  const reasonValid =
    trimmed.length >= MODERATION_REASON_MIN_LENGTH &&
    trimmed.length <= MODERATION_REASON_MAX_LENGTH

  const send = async (step: ModerationAppealStep) => {
    if (inFlight.current || !reasonValid || !sanction) return
    inFlight.current = true
    setSubmitting(true)
    setFailure(null)
    setLastStep(step)
    const payload = { status: step, reason: trimmed }
    try {
      await recordModerationAppealFromWeb(sanction.sanctionId, {
        ...payload,
        mutationId: keeper.idFor({ sanctionId: sanction.sanctionId, ...payload }),
      })
      keeper.clear()
      setReason('')
      onApplied(t(`moderation.standing.outcome.${step}`))
    } catch (error) {
      const next = moderationDecisionFailure(error)
      failedReason.current = trimmed
      if (next.failure === 'idempotency_mismatch') keeper.clear()
      setFailure(next)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const expiry = sanction?.expiresAt
    ? new Intl.DateTimeFormat(i18n.language || 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(sanction.expiresAt))
    : null

  return (
    <section aria-labelledby="standing-heading" className={moderationCard}>
      <h2 id="standing-heading" className="mb-3 text-lg font-semibold">
        {t('moderation.standing.title')}
      </h2>
      {sanction ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">{t('moderation.standing.state')}</dt>
          <dd>
            {t(
              standing.active ? 'moderation.standing.active' : 'moderation.standing.ended'
            )}
          </dd>
          <dt className="font-medium">{t('moderation.standing.kindLabel')}</dt>
          <dd>{t(`moderation.standing.kind.${sanction.kind}`)}</dd>
          {expiry ? (
            <>
              <dt className="font-medium">{t('moderation.standing.expires')}</dt>
              <dd>{expiry}</dd>
            </>
          ) : null}
          <dt className="font-medium">{t('moderation.standing.appealLabel')}</dt>
          <dd>{t(`moderation.standing.appeal.${sanction.appealStatus}`)}</dd>
          <dt className="font-medium">{t('moderation.standing.priorBans')}</dt>
          <dd>{standing.priorBanCount}</dd>
        </dl>
      ) : (
        <p className="text-sm">{t('moderation.standing.none')}</p>
      )}
      {standing.allowedAppealSteps.length > 0 ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('moderation.standing.appealReason')}
            <textarea
              className="min-h-[72px] rounded border border-neutral-500 bg-white p-2 text-sm font-normal text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)] dark:bg-neutral-900 dark:text-neutral-100"
              aria-required="true"
              aria-invalid={trimmed.length > MODERATION_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {failure ? (
            <DecisionFailureNotice
              state={failure}
              // An edited note is a new request, which goes through the step buttons.
              onRetry={
                failedReason.current === trimmed && lastStep
                  ? () => void send(lastStep)
                  : undefined
              }
              onReload={() => {
                setFailure(null)
                onReload()
              }}
            />
          ) : null}
          <div className="flex flex-wrap gap-3">
            {standing.allowedAppealSteps.map((step) => (
              <button
                key={step}
                type="button"
                className={moderationControl}
                aria-disabled={!reasonValid || submitting}
                onClick={() => void send(step)}
              >
                {t(`moderation.standing.step.${step}`)}
              </button>
            ))}
          </div>
        </form>
      ) : null}
    </section>
  )
}
