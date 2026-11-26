'use client'

// Story 6.10 web owner: the case view at `/moderation/cases/[caseId]`.
// The detail loads once per navigation. Focus, visibility, online, timer and strict-mode effects never refetch it,
// because every read writes one audit row. Reload is a user action.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  communityModerationReasonCategorySchema,
  type ModerationCaseDetail,
} from '@couture/api-client/contracts/http'
import {
  useModerationTranslation,
  getModerationCaseFromWeb,
  isTerminalFailure,
  moderationFailureReason,
  type ModerationCaseResult,
  type ModerationFailureReason,
} from '../../lib/moderation'
import { ModerationAccountStanding } from './moderation-account-standing'
import { CaseMedia } from './moderation-case-media'
import { ModerationDecisionPanel, moderationCard } from './moderation-decision-panel'
import { ModerationEvidenceExport } from './moderation-evidence-export'
import { FailureNotice, moderationControl } from './moderation-failure-notice'
import { PlainText } from './moderation-plain-text'
import { SlaCountdown } from './moderation-sla-countdown'

const control = moderationControl
const card = moderationCard
const RISK_CLASS = {
  high: 'bg-danger-surface text-danger-ink ring-danger-line',
  medium: 'bg-notice-surface text-notice-ink ring-notice-line',
  low: 'bg-card-muted text-ink ring-line-strong',
} as const
const note =
  'rounded-md border border-notice-line bg-notice-surface p-3 text-sm text-notice-ink'

function useDateFormat() {
  const { i18n } = useModerationTranslation()
  return (iso: string) =>
    new Intl.DateTimeFormat(i18n.language || 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
}

/** A case read has no filter or cursor, so a 400 there is a server fault. */
function detailReason(reason: ModerationFailureReason | null): ModerationFailureReason {
  return reason === null || reason === 'invalid_filter' || reason === 'invalid_cursor'
    ? 'unavailable'
    : reason
}

export function ModerationCaseDetailView({ caseId }: { caseId: string }) {
  const { t } = useModerationTranslation()
  const [detail, setDetail] = useState<ModerationCaseResult | null>(null)
  const [failure, setFailure] = useState<ModerationFailureReason | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const started = useRef<string | null>(null)
  const alive = useRef(true)
  const hasDetail = useRef(false)
  const sequence = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  hasDetail.current = detail !== null
  // One polite region outside the panel, so an outcome is announced once and survives the reload.
  const [outcome, setOutcome] = useState<string | null>(null)
  const outcomeRef = useRef<HTMLParagraphElement>(null)

  const read = useCallback(async () => {
    // A newer read, or a new case id, makes every older answer stale. It is dropped, never applied.
    const mine = (sequence.current += 1)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const next = await getModerationCaseFromWeb(caseId, controller.signal)
      if (!alive.current || mine !== sequence.current) return
      setDetail(next)
      setFailure(null)
      setStale(false)
    } catch (error) {
      if (!alive.current || mine !== sequence.current) return
      const reason = moderationFailureReason(error)
      setFailure(reason)
      if (isTerminalFailure(reason)) {
        // Access is gone or the case was re-keyed: nothing from the last read may stay on screen.
        setDetail(null)
        setStale(false)
      } else if (hasDetail.current) {
        setStale(true)
      }
    } finally {
      if (alive.current && mine === sequence.current) setLoading(false)
    }
  }, [caseId])

  useEffect(() => {
    alive.current = true
    // A ref survives the strict-mode remount, so the same navigation never reads twice.
    if (started.current !== caseId) {
      started.current = caseId
      setDetail(null)
      setFailure(null)
      setStale(false)
      setOutcome(null)
      void read()
    }
    return () => {
      alive.current = false
    }
  }, [caseId, read])

  const reload = () => {
    if (!loading) void read()
  }

  const applied = (message: string) => {
    setOutcome(message)
    void read().then(() => outcomeRef.current?.focus())
  }

  if (!detail) {
    return (
      // Story CC-7.9 D6: the top bar's back control returns to the queue, so the view has none.
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {loading ? (
          <p aria-busy="true">{t('moderation.state.loading')}</p>
        ) : (
          <FailureNotice
            reason={detailReason(failure)}
            onRetry={reload}
            busy={loading}
            scope="case"
          />
        )}
      </div>
    )
  }

  return (
    <article
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      aria-labelledby="case-heading"
    >
      <DetailHeader
        detail={detail}
        stale={stale}
        loading={loading}
        onReload={reload}
        announceSla={outcome === null}
      />
      <p
        ref={outcomeRef}
        role="status"
        tabIndex={-1}
        data-testid="moderation-decision-outcome"
        className={
          outcome
            ? 'rounded-md border border-line bg-card p-3 text-sm text-success-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'
            : 'sr-only'
        }
      >
        {outcome}
      </p>
      <ModerationDecisionPanel detail={detail} onApplied={applied} onReload={reload} />
      <ModerationEvidenceExport caseId={detail.caseId} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ContentSection detail={detail} />
          <section aria-labelledby="media-heading" data-surface="card" className={card}>
            <h2 id="media-heading" className="mb-3 text-lg font-semibold">
              {t('moderation.detail.media')}
            </h2>
            <CaseMedia
              media={detail.media}
              clockOffsetMs={detail.clockOffsetMs}
              onReload={reload}
            />
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <FindingsSection detail={detail} />
          <ReportersSection detail={detail} />
          <ModerationAccountStanding
            detail={detail}
            onApplied={applied}
            onReload={reload}
          />
          <PriorActionsSection detail={detail} />
        </div>
      </div>
    </article>
  )
}

function DetailHeader({
  detail,
  stale,
  loading,
  onReload,
  announceSla,
}: {
  detail: ModerationCaseResult
  stale: boolean
  loading: boolean
  onReload: () => void
  /** A decision's own outcome is the one announcement, so the SLA change it causes stays silent. */
  announceSla: boolean
}) {
  const { t } = useModerationTranslation()
  const format = useDateFormat()
  return (
    <header className="flex flex-col gap-3">
      {/* Story CC-7.9 D6: the top bar owns the page's one h1, so the case title is the first h2. */}
      <h2 id="case-heading" tabIndex={-1} className="text-2xl font-semibold">
        {t('moderation.detail.title', {
          source: t(`moderation.source.${detail.source}`),
        })}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex min-h-[28px] items-center rounded-md px-2 text-sm font-semibold ring-1 ring-inset ${RISK_CLASS[detail.risk]}`}
        >
          {t('moderation.riskLabel', { risk: t(`moderation.risk.${detail.risk}`) })}
        </span>
        <span
          className="text-sm font-medium"
          data-sla-state={detail.status === 'resolved' ? 'resolved' : undefined}
        >
          {t(`moderation.status.${detail.status}`)}
        </span>
        {/* A resolved case says so once, in the status beside this. */}
        {detail.status === 'open' ? (
          <SlaCountdown
            dueAt={detail.slaDueAt}
            clockOffsetMs={detail.clockOffsetMs}
            resolved={false}
            announce={announceSla}
          />
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">
        {t('moderation.detail.accepted', { when: format(detail.acceptedAt) })}
        {' · '}
        {t('moderation.queue.reports', { count: detail.reportCount })}
        {detail.locale ? ` · ${detail.locale}` : ''}
        {detail.firstDecisionAt
          ? ` · ${t('moderation.detail.firstDecision', { when: format(detail.firstDecisionAt) })}`
          : ''}
      </p>
      {detail.escalated ? (
        <p role="note" className={note}>
          {t('moderation.detail.escalated')}
        </p>
      ) : null}
      {detail.viewerConflict ? (
        <p role="note" className={note}>
          {t('moderation.detail.conflict')}
        </p>
      ) : null}
      {/* One button in one place, so keyboard focus survives the stale banner appearing or clearing. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={control}
          aria-disabled={loading}
          onClick={onReload}
        >
          {t(stale ? 'moderation.state.retry' : 'moderation.detail.reload')}
        </button>
        {stale ? (
          <p role="alert" className={note}>
            {t('moderation.state.stale')}
          </p>
        ) : null}
      </div>
    </header>
  )
}

function Identity({ identity }: { identity: ModerationCaseDetail['subject'] }) {
  const { t } = useModerationTranslation()
  return identity.alias ? (
    <PlainText value={identity.alias} />
  ) : (
    <span>{t(`moderation.alias.${identity.state}`)}</span>
  )
}

function ContentSection({ detail }: { detail: ModerationCaseDetail }) {
  const { t } = useModerationTranslation()
  const format = useDateFormat()
  const { snapshot, target } = detail
  return (
    <section aria-labelledby="content-heading" data-surface="card" className={card}>
      <h2 id="content-heading" className="mb-3 text-lg font-semibold">
        {t('moderation.detail.content')}
      </h2>
      <dl className="grid grid-cols-1 gap-3 text-sm">
        <div>
          <dt className="font-medium">{t('moderation.detail.subject')}</dt>
          <dd>
            <Identity identity={detail.subject} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('moderation.detail.reportedVersion')}</dt>
          <dd className="flex flex-col gap-2">
            {!snapshot.available ? (
              <span>{t('moderation.detail.snapshotUnavailable')}</span>
            ) : (
              <>
                {snapshot.title ? (
                  <strong data-testid="moderation-snapshot-title">
                    <PlainText value={snapshot.title} />
                  </strong>
                ) : null}
                {snapshot.caption ? <PlainText value={snapshot.caption} /> : null}
                {snapshot.body ? <PlainText value={snapshot.body} /> : null}
                {snapshot.altText ? (
                  <span>
                    <span className="font-medium">
                      {t('moderation.detail.altText')}:{' '}
                    </span>
                    <PlainText value={snapshot.altText} />
                  </span>
                ) : null}
                {!snapshot.title &&
                !snapshot.caption &&
                !snapshot.body &&
                !snapshot.altText ? (
                  <span>{t('moderation.detail.snapshotEmpty')}</span>
                ) : null}
                {snapshot.capturedAt ? (
                  <span className="text-ink-soft">
                    {t('moderation.detail.capturedAt', {
                      when: format(snapshot.capturedAt),
                    })}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('moderation.detail.currentState')}</dt>
          <dd className="flex flex-col gap-1">
            {target.state === 'erased' ? (
              <span>{t('moderation.detail.targetErased')}</span>
            ) : (
              <>
                <span>
                  {t('moderation.detail.targetStatus')}:{' '}
                  {t(`moderation.targetStatus.${target.status ?? 'unknown'}`, {
                    defaultValue: t('moderation.targetStatus.unknown'),
                  })}
                </span>
                {target.publishedAt ? (
                  <span>
                    {t('moderation.detail.publishedAt', {
                      when: format(target.publishedAt),
                    })}
                  </span>
                ) : null}
                {target.parentBody ? (
                  <span>
                    <span className="font-medium">
                      {t('moderation.detail.parentComment')}:{' '}
                    </span>
                    <PlainText value={target.parentBody} />
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}

const KNOWN_CATEGORIES: readonly string[] =
  communityModerationReasonCategorySchema.options

/** An unknown category from a newer server reads as a neutral label, never as a raw key. */
const categoryKey = (category: string) =>
  KNOWN_CATEGORIES.includes(category)
    ? `moderation.category.${category}`
    : 'moderation.category.unknown'

function FindingsSection({ detail }: { detail: ModerationCaseDetail }) {
  const { t } = useModerationTranslation()
  const { findings } = detail
  const machine =
    findings !== null && (findings.categories.length > 0 || findings.codes.length > 0)
  const note = findings?.operatorNote ?? null
  return (
    <>
      <section aria-labelledby="findings-heading" data-surface="card" className={card}>
        <h2 id="findings-heading" className="mb-3 text-lg font-semibold">
          {t('moderation.detail.findings')}
        </h2>
        {machine ? (
          <dl className="grid grid-cols-1 gap-3 text-sm">
            {findings.categories.length > 0 ? (
              <div>
                <dt className="font-medium">{t('moderation.detail.categories')}</dt>
                <dd>{findings.categories.map((c) => t(categoryKey(c))).join(', ')}</dd>
              </div>
            ) : null}
            {findings.codes.length > 0 ? (
              <div>
                <dt className="font-medium">{t('moderation.detail.codes')}</dt>
                <dd>
                  <code>{findings.codes.join(', ')}</code>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm">
            {t(
              findings && !note
                ? 'moderation.detail.heldNoCodes'
                : 'moderation.detail.noFindings'
            )}
          </p>
        )}
        {findings?.engineVersion ? (
          <dl className="mt-3 text-sm">
            <dt className="font-medium">{t('moderation.detail.engine')}</dt>
            <dd>
              <code>{findings.engineVersion}</code>
            </dd>
          </dl>
        ) : null}
      </section>
      {/* An operator's words are no machine verdict, so they sit under their own heading. */}
      {note ? (
        <section
          aria-labelledby="operator-note-heading"
          data-surface="card"
          className={card}
        >
          <h2 id="operator-note-heading" className="mb-3 text-lg font-semibold">
            {t('moderation.detail.operatorNote')}
          </h2>
          <div className="text-sm">
            <PlainText value={note} />
          </div>
        </section>
      ) : null}
    </>
  )
}

function ReportersSection({ detail }: { detail: ModerationCaseDetail }) {
  const { t } = useModerationTranslation()
  const format = useDateFormat()
  return (
    <section aria-labelledby="reporters-heading" data-surface="card" className={card}>
      <h2 id="reporters-heading" className="mb-3 text-lg font-semibold">
        {t('moderation.detail.reporters')}
      </h2>
      <ul className="flex flex-col gap-4">
        {detail.reporters.map((reporter, index) => (
          <li key={index} className="text-sm">
            <p className="font-medium">
              {reporter.origin === 'screening' ? (
                t('moderation.detail.reporterScreening')
              ) : (
                <Identity identity={reporter.identity} />
              )}
              {' · '}
              {t(`moderation.reason.${reporter.reason}`)}
            </p>
            <p className="text-ink-soft">
              {format(reporter.reportedAt)}
              {reporter.resolved ? ` · ${t('moderation.status.resolved')}` : ''}
            </p>
            {reporter.details ? (
              <blockquote className="mt-1 border-l-4 border-line-strong pl-3">
                <PlainText value={reporter.details} />
              </blockquote>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PriorActionsSection({ detail }: { detail: ModerationCaseDetail }) {
  const { t } = useModerationTranslation()
  const format = useDateFormat()
  return (
    <section aria-labelledby="actions-heading" data-surface="card" className={card}>
      <h2 id="actions-heading" className="mb-3 text-lg font-semibold">
        {t('moderation.detail.priorActions')}
      </h2>
      {detail.priorActions.length === 0 ? (
        <p className="text-sm">{t('moderation.detail.noPriorActions')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {detail.priorActions.map((action, index) => (
            <li key={index} className="text-sm">
              <p className="font-medium">
                {t(`moderation.actor.${action.actorKind}`)}
                {' · '}
                {t(`moderation.action.${action.action}`, {
                  defaultValue: t('moderation.action.unknown'),
                })}
              </p>
              <p className="text-ink-soft">{format(action.occurredAt)}</p>
              {action.reasonRemoved ? (
                <p className="text-ink-soft italic">
                  {t('moderation.detail.reasonRemoved')}
                </p>
              ) : action.reason ? (
                <PlainText value={action.reason} />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
