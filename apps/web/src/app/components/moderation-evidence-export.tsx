'use client'

// Story 6.13 web owner: the evidence export controls on the case detail and at `/moderation/evidence`.
// The API decides who may export what. These read its answer, so a closed feature shows no control.
import Link from 'next/link'
import { useEffect, useId, useState, type FormEvent } from 'react'
import {
  isModerationEvidenceRangeValid,
  type ModerationEvidenceBundle,
} from '@couture/api-client/contracts/http'
import {
  exportModerationEvidenceFromWeb,
  getModerationEvidenceAvailabilityFromWeb,
  ModerationEvidenceRequestError,
  saveModerationEvidenceFile,
  useModerationTranslation,
  type ModerationEvidenceFailure,
} from '../../lib/moderation'
import { moderationControl } from './moderation-failure-notice'

const card = 'rounded-lg border border-neutral-400 p-4 dark:border-neutral-600'
const input =
  'min-h-[44px] rounded border border-neutral-500 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)] dark:bg-neutral-900 dark:text-neutral-100'

type Availability = 'loading' | 'off' | 'case' | 'range'

function useEvidenceAvailability(): Availability {
  const [availability, setAvailability] = useState<Availability>('loading')
  useEffect(() => {
    const controller = new AbortController()
    void getModerationEvidenceAvailabilityFromWeb(controller.signal).then((answer) => {
      if (controller.signal.aborted) return
      setAvailability(answer === null ? 'off' : answer.rangeExport ? 'range' : 'case')
    })
    return () => controller.abort()
  }, [])
  return availability
}

type ExportState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'done'; bundle: ModerationEvidenceBundle }
  | { phase: 'failed'; failure: ModerationEvidenceFailure }

function useEvidenceExport() {
  const [state, setState] = useState<ExportState>({ phase: 'idle' })
  const run = async (
    request: Parameters<typeof exportModerationEvidenceFromWeb>[0]
  ): Promise<void> => {
    setState({ phase: 'working' })
    try {
      const file = await exportModerationEvidenceFromWeb(request)
      saveModerationEvidenceFile(file)
      setState({ phase: 'done', bundle: file.bundle })
    } catch (error) {
      setState({
        phase: 'failed',
        failure:
          error instanceof ModerationEvidenceRequestError ? error.failure : 'unavailable',
      })
    }
  }
  return {
    state,
    run,
    fail: (failure: ModerationEvidenceFailure) => setState({ phase: 'failed', failure }),
  }
}

/** One polite announcement per change. A failure is shown in the same place, so focus stays where it was. */
function ExportStatus({ state }: { state: ExportState }) {
  const { t } = useModerationTranslation()
  if (state.phase === 'idle')
    return <p role="status" aria-live="polite" className="sr-only" />
  if (state.phase === 'working')
    return (
      <p role="status" aria-live="polite" className="text-sm">
        {t('moderation.evidence.working')}
      </p>
    )
  if (state.phase === 'failed')
    return (
      <p
        role="status"
        aria-live="polite"
        className="rounded border border-red-800 p-3 text-sm dark:border-red-400"
      >
        {t(`moderation.evidence.failure.${state.failure}`)}
      </p>
    )
  const { counts, sha256 } = state.bundle
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-1 rounded border border-green-800 p-3 text-sm dark:border-green-500"
    >
      <p className="font-medium">
        {t('moderation.evidence.done', {
          decisions: counts.decisions,
          reports: counts.reports,
          auditEvents: counts.auditEvents,
          alerts: counts.alerts,
        })}
      </p>
      {counts.withheldForConflict > 0 ? (
        <p>{t('moderation.evidence.withheld', { count: counts.withheldForConflict })}</p>
      ) : null}
      <p className="break-all">
        {t('moderation.evidence.digest')}{' '}
        <code className="font-mono text-xs">{sha256}</code>
      </p>
    </div>
  )
}

export function ModerationEvidenceExport({ caseId }: { caseId: string }) {
  const { t } = useModerationTranslation()
  const availability = useEvidenceAvailability()
  const { state, run } = useEvidenceExport()
  if (availability === 'loading' || availability === 'off') return null
  const working = state.phase === 'working'
  return (
    <section aria-labelledby="evidence-heading" className={`${card} flex flex-col gap-3`}>
      <h2 id="evidence-heading" className="text-lg font-semibold">
        {t('moderation.evidence.caseTitle')}
      </h2>
      <p className="text-sm">{t('moderation.evidence.caseHelp')}</p>
      <div>
        <button
          type="button"
          className={moderationControl}
          aria-disabled={working}
          aria-busy={working}
          onClick={() => {
            if (!working) void run({ scope: 'case', caseId })
          }}
        >
          {t('moderation.evidence.exportCase')}
        </button>
      </div>
      <ExportStatus state={state} />
    </section>
  )
}

/** Shown only to a viewer the API says may export a period. */
export function ModerationEvidenceLink() {
  const { t } = useModerationTranslation()
  if (useEvidenceAvailability() !== 'range') return null
  return (
    <Link
      href="/moderation/evidence"
      className={`${moderationControl} inline-flex items-center`}
    >
      {t('moderation.evidence.link')}
    </Link>
  )
}

export function ModerationEvidenceRange() {
  const { t } = useModerationTranslation()
  const availability = useEvidenceAvailability()
  const { state, run, fail } = useEvidenceExport()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const fromId = useId()
  const toId = useId()
  const working = state.phase === 'working'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (working) return
    // Whole UTC days, so the same dates select the same rows wherever the reviewer sits.
    const range = {
      from: `${from}T00:00:00.000Z`,
      to: `${to}T23:59:59.999Z`,
    }
    if (!from || !to || !isModerationEvidenceRangeValid(range)) {
      fail('invalid_range')
      return
    }
    void run({ scope: 'range', ...range })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href="/moderation" className="text-sm underline underline-offset-2">
          {t('moderation.backToQueue')}
        </Link>
        <h1 className="text-3xl font-semibold">{t('moderation.evidence.title')}</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('moderation.evidence.subtitle')}
        </p>
      </header>
      {availability === 'loading' ? (
        <p aria-busy="true">{t('moderation.state.loading')}</p>
      ) : availability === 'off' ? (
        <p role="alert" className="rounded border border-neutral-500 p-4">
          {t('moderation.evidence.failure.moderation_history_disabled')}
        </p>
      ) : availability === 'case' ? (
        <p role="alert" className="rounded border border-neutral-500 p-4">
          {t('moderation.evidence.failure.admin_required')}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={fromId} className="text-sm font-medium">
                {t('moderation.evidence.from')}
              </label>
              <input
                id={fromId}
                type="date"
                className={input}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={toId} className="text-sm font-medium">
                {t('moderation.evidence.to')}
              </label>
              <input
                id={toId}
                type="date"
                className={input}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          <p className="text-sm">{t('moderation.evidence.rangeHelp')}</p>
          <div>
            <button
              type="submit"
              className={moderationControl}
              aria-disabled={working}
              aria-busy={working}
            >
              {t('moderation.evidence.exportRange')}
            </button>
          </div>
          <ExportStatus state={state} />
        </form>
      )}
    </div>
  )
}
