'use client'

// Story 6.11 web owner: the decision form of the case view.
// It renders only what the API allows this viewer now and decides nothing about roles.
// A typed reason survives every recoverable failure. There is no browser dialog: a takedown and a ban confirm in place.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MODERATION_BAN_DURATION_DAYS,
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_REASON_MIN_LENGTH,
  type ModerationDecisionAction,
  type ModerationDecisionDetail,
  type ModerationDecisionInput,
  type ModerationDecisionResult,
  type ModerationSanctionKind,
} from '@couture/api-client/contracts/http'
import {
  applyModerationDecisionFromWeb,
  createMutationIdKeeper,
  moderationDecisionFailure,
  RETRYABLE_DECISION_FAILURES,
  useModerationTranslation,
  type ModerationCaseResult,
  type ModerationDecisionFailure,
} from '../../lib/moderation'
import { moderationControl } from './moderation-failure-notice'

const field =
  'min-h-[44px] rounded border border-neutral-500 bg-white p-2 text-sm text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)] dark:bg-neutral-900 dark:text-neutral-100'
export const moderationCard =
  'rounded-lg border border-neutral-400 bg-white p-4 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'

const CONFIRMED: readonly ModerationDecisionAction[] = ['takedown', 'ban']
type Duration = (typeof MODERATION_BAN_DURATION_DAYS)[number]

export interface DecisionFailureState {
  failure: ModerationDecisionFailure
  detail: ModerationDecisionDetail | null
}

/** The sentence and the recovery of one failure. Shared with the appeal form. */
export function DecisionFailureNotice({
  state,
  onRetry,
  onReload,
}: {
  state: DecisionFailureState
  onRetry: () => void
  onReload: () => void
}) {
  const { t } = useModerationTranslation()
  const retryable = RETRYABLE_DECISION_FAILURES.includes(state.failure)
  const message = state.detail
    ? t(`moderation.decision.detail.${state.detail}`)
    : t(`moderation.decision.error.${state.failure}`)
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded border border-red-800 p-3 text-sm dark:border-red-400"
    >
      <p>{message}</p>
      {retryable ? (
        <button
          type="button"
          className={`${moderationControl} self-start`}
          onClick={onRetry}
        >
          {t('moderation.state.retry')}
        </button>
      ) : (
        <button
          type="button"
          className={`${moderationControl} self-start`}
          onClick={onReload}
        >
          {t('moderation.detail.reload')}
        </button>
      )}
    </div>
  )
}

type Translate = ReturnType<typeof useModerationTranslation>['t']

function decisionOutcomeMessage(
  result: ModerationDecisionResult,
  t: Translate,
  language: string
): string {
  const until = result.sanction?.expiresAt
    ? new Intl.DateTimeFormat(language || 'en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date(result.sanction.expiresAt))
    : null
  const outcome =
    result.action === 'ban'
      ? until
        ? t('moderation.decision.outcome.banTemporary', { until })
        : t('moderation.decision.outcome.banPermanent')
      : t(`moderation.decision.outcome.${result.action}`)
  return result.cacheInvalidation === 'deferred'
    ? `${outcome} ${t('moderation.decision.outcome.deferred')}`
    : outcome
}

const isValidReason = (trimmed: string) =>
  trimmed.length >= MODERATION_REASON_MIN_LENGTH &&
  trimmed.length <= MODERATION_REASON_MAX_LENGTH

function BanTermsFields({
  banKinds,
  banKind,
  durationDays,
  onKind,
  onDuration,
}: {
  banKinds: readonly ModerationSanctionKind[]
  banKind: ModerationSanctionKind
  durationDays: Duration
  onKind: (kind: ModerationSanctionKind) => void
  onDuration: (days: Duration) => void
}) {
  const { t } = useModerationTranslation()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('moderation.decision.banKind')}
        <select
          className={field}
          value={banKind}
          onChange={(event) => onKind(event.target.value as ModerationSanctionKind)}
        >
          {banKinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`moderation.standing.kind.${kind}`)}
            </option>
          ))}
        </select>
      </label>
      {banKind === 'temporary' ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('moderation.decision.duration')}
          <select
            className={field}
            value={durationDays}
            onChange={(event) => onDuration(Number(event.target.value) as Duration)}
          >
            {MODERATION_BAN_DURATION_DAYS.map((days) => (
              <option key={days} value={days}>
                {t('moderation.decision.days', { count: days })}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  )
}

/** The chosen value while the API still offers it, else its first offer. */
function stillOffered<T>(chosen: T | null, offered: readonly T[], fallback: T | null) {
  return chosen !== null && offered.includes(chosen) ? chosen : (offered[0] ?? fallback)
}

export function ModerationDecisionPanel({
  detail,
  onApplied,
  onReload,
}: {
  detail: ModerationCaseResult
  onApplied: (message: string) => void
  onReload: () => void
}) {
  const { t, i18n } = useModerationTranslation()
  const allowed = detail.allowedActions
  const [chosen, setChosen] = useState<ModerationDecisionAction | null>(
    allowed[0] ?? null
  )
  // A reload can narrow the list. The panel then never sends an action the API stopped offering.
  const action = stillOffered(chosen, allowed, null)
  const [reason, setReason] = useState('')
  const [chosenKind, setChosenKind] = useState<ModerationSanctionKind>(
    detail.banKinds[0] ?? 'temporary'
  )
  const banKind = stillOffered(chosenKind, detail.banKinds, chosenKind) ?? chosenKind
  const [durationDays, setDurationDays] = useState<Duration>(7)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<DecisionFailureState | null>(null)
  const inFlight = useRef(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  const keeper = useMemo(() => createMutationIdKeeper(), [])
  // The control that held focus is gone after a confirmation closes, so focus returns on the
  // next commit, when the submit button exists again.
  const focusSubmit = useRef(false)
  useEffect(() => {
    if (confirming || !focusSubmit.current) return
    focusSubmit.current = false
    submitRef.current?.focus()
  }, [confirming])
  // A new reading answers the old failure. The typed reason stays.
  useEffect(() => {
    setFailure(null)
    setConfirming(false)
    // The Reload inside the failure notice goes away with it.
    if (focusSubmit.current) {
      focusSubmit.current = false
      submitRef.current?.focus()
    }
  }, [detail.revision])

  if (!action || allowed.length === 0) return null

  const trimmed = reason.trim()
  const reasonValid = isValidReason(trimmed)

  const send = async () => {
    if (inFlight.current || !reasonValid) return
    inFlight.current = true
    setSubmitting(true)
    setFailure(null)
    const ban =
      banKind === 'temporary'
        ? { kind: 'temporary' as const, durationDays }
        : { kind: 'permanent' as const }
    const payload = { action, reason: trimmed, ...(action === 'ban' ? { ban } : {}) }
    const input = {
      ...payload,
      mutationId: keeper.idFor(payload),
      expectedRevision: detail.revision,
    } as ModerationDecisionInput
    try {
      const result = await applyModerationDecisionFromWeb(detail.caseId, input)
      keeper.clear()
      setReason('')
      setConfirming(false)
      onApplied(decisionOutcomeMessage(result, t, i18n.language))
    } catch (error) {
      const next = moderationDecisionFailure(error)
      // That id belongs to a different request, so retrying with it can only fail again.
      if (next.failure === 'idempotency_mismatch') keeper.clear()
      setFailure(next)
      focusSubmit.current = confirming
      setConfirming(false)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const submit = () => {
    if (!reasonValid || submitting) return
    if (CONFIRMED.includes(action)) {
      setConfirming(true)
      return
    }
    void send()
  }

  const cancelConfirm = () => {
    focusSubmit.current = true
    setConfirming(false)
  }

  const counterId = 'moderation-decision-count'
  return (
    <section aria-labelledby="decision-heading" className={moderationCard}>
      <h2 id="decision-heading" className="mb-3 text-lg font-semibold">
        {t('moderation.decision.title')}
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">
            {t('moderation.decision.actionLabel')}
          </legend>
          {allowed.map((option) => (
            <label key={option} className="flex min-h-[44px] items-center gap-3 text-sm">
              <input
                type="radio"
                name="moderation-decision-action"
                className="h-5 min-h-0 w-5 min-w-0 shrink-0"
                checked={action === option}
                onChange={() => {
                  setChosen(option)
                  setConfirming(false)
                  setFailure(null)
                }}
              />
              <span>
                <span className="font-medium">
                  {t(`moderation.decision.action.${option}`)}
                </span>
                <span className="block text-neutral-700 dark:text-neutral-300">
                  {t(`moderation.decision.hint.${option}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {action === 'ban' ? (
          <BanTermsFields
            banKinds={detail.banKinds}
            banKind={banKind}
            durationDays={durationDays}
            onKind={setChosenKind}
            onDuration={setDurationDays}
          />
        ) : null}

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('moderation.decision.reason')}
          <textarea
            className={`${field} min-h-[96px] font-normal`}
            aria-required="true"
            aria-invalid={trimmed.length > MODERATION_REASON_MAX_LENGTH}
            value={reason}
            aria-describedby={counterId}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p id={counterId} className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('moderation.decision.reasonCount', {
            count: trimmed.length,
            max: MODERATION_REASON_MAX_LENGTH,
            min: MODERATION_REASON_MIN_LENGTH,
          })}
        </p>

        {failure ? (
          <DecisionFailureNotice
            state={failure}
            onRetry={() => void send()}
            onReload={() => {
              focusSubmit.current = true
              onReload()
            }}
          />
        ) : null}

        {confirming ? (
          <div
            role="group"
            aria-labelledby="decision-confirm"
            className="flex flex-col gap-3 rounded border border-amber-700 p-3 text-sm"
          >
            <p id="decision-confirm">
              {t(
                `moderation.decision.confirm.${action === 'ban' ? `ban_${banKind}` : action}`
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                autoFocus
                className={moderationControl}
                aria-disabled={submitting}
                onClick={() => void send()}
              >
                {t(
                  submitting
                    ? 'moderation.decision.submitting'
                    : 'moderation.decision.confirmYes'
                )}
              </button>
              <button type="button" className={moderationControl} onClick={cancelConfirm}>
                {t('moderation.decision.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              ref={submitRef}
              type="submit"
              className={moderationControl}
              aria-disabled={!reasonValid || submitting}
            >
              {t(
                submitting
                  ? 'moderation.decision.submitting'
                  : 'moderation.decision.submit'
              )}
            </button>
          </div>
        )}
      </form>
    </section>
  )
}
