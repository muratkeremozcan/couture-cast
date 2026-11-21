'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  garmentCategoryEnum,
  type RitualResponse,
  type ScenarioOutfit,
} from '@couture/api-client/contracts/http'
import {
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
  type GuestPreviewStrings,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { formatPlannerTemperature } from '../../lib/planner'
import { captureLocationCredentials, listLocationsFromWeb } from '../../lib/locations'
import { getRitualFromWeb, ritualFailure, SET_CITY_FROM_HOME } from '../../lib/ritual'
import {
  currentWebSessionBearer,
  isLiveOwner,
  MemberScope,
  type MemberSession,
} from '../../lib/use-web-session'
import { GuestPreviewOutfit } from './guest-preview/guest-preview-outfit'
import { GuestPreviewSwapDialog } from './guest-preview/guest-preview-swap-dialog'
import { RitualShareCardLauncher } from './ritual-share-card-launcher'

const linkClass =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold underline underline-offset-4'
const primaryLinkClass =
  'inline-flex min-h-11 items-center rounded-lg bg-[#111111] px-4 text-sm font-semibold text-white'

let retainedSample: { owner: string; result: SampleOutfitResult } | undefined

function resetSampleForOwner(owner: string | null) {
  if (retainedSample?.owner !== owner) retainedSample = undefined
}

function AddGarment({ strings }: { strings: GuestPreviewStrings }) {
  return (
    <Link
      href="/wardrobe?entry=add"
      data-testid="home-add-garment"
      className={primaryLinkClass}
    >
      {strings.firstUse.addGarment}
    </Link>
  )
}

function SampleOutfit({
  owner,
  locale,
  strings,
  actions,
}: {
  owner: string
  locale: string
  strings: GuestPreviewStrings
  actions: ReactNode
}) {
  const [result, setResult] = useState(() =>
    retainedSample?.owner === owner ? retainedSample.result : createMemberSampleOutfit()
  )
  const [category, setCategory] = useState<SampleGarmentCategory | null>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const update = (next: SampleOutfitResult) => {
    if (!isLiveOwner(owner)) return
    retainedSample = { owner, result: next }
    setResult(next)
  }
  const lookId = result.look?.id
  const currentId = result.garments.find((garment) => garment.category === category)?.id
  return (
    <div data-testid="member-sample-outfit" className="space-y-3 text-[#111111]">
      <p className="text-sm text-[color:var(--lookbook-ink)]">
        {strings.chrome.sampleLabel}
      </p>
      <GuestPreviewOutfit
        result={result}
        strings={strings}
        locale={locale}
        heading={strings.firstUse.outfitIdea}
        continuation={
          <div className="mb-2 flex flex-wrap gap-2">
            <AddGarment strings={strings} />
            {actions}
          </div>
        }
        noAlternative={result.eligibleLookIds.length < 2}
        hasSwaps={Boolean(lookId && result.input.swaps[lookId])}
        onTryAnother={() => update(rotateMemberSampleOutfit(result))}
        onSwap={(slot, button) => {
          invoker.current = button
          setCategory(slot)
        }}
        onUndoSwaps={() => update(undoMemberSampleSwaps(result))}
        onReviewChoices={() => update(createMemberSampleOutfit())}
        onResetChoices={() => update(createMemberSampleOutfit())}
      />
      <GuestPreviewSwapDialog
        category={category}
        currentId={currentId}
        candidates={
          category ? sampleSwapCandidates(SAMPLE_CATALOG, category, result.input) : []
        }
        strings={strings}
        invokerRef={invoker}
        onChoose={(garmentId) => {
          if (category) update(swapMemberSampleGarment(result, category, garmentId))
          setCategory(null)
        }}
        onClose={() => setCategory(null)}
      />
    </div>
  )
}

function usableOutfit(outfit: ScenarioOutfit) {
  return outfit.garmentIds.length > 0
}

type LiveRitual = RitualResponse['data']

function LiveOutfit({
  ritual,
  city,
  stale,
}: {
  ritual: LiveRitual
  city: string | undefined
  stale: boolean
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  const available = ritual.outfits.filter(usableOutfit)
  const [scenario, setScenario] = useState<ScenarioOutfit['scenario']>('morning')
  const outfit = available.find((item) => item.scenario === scenario) ?? available[0]
  const starterOnly = available.every((item) => !item.displayGarments?.length)
  if (!outfit) return null
  return (
    <div
      data-testid="home-live-outfit"
      className="min-w-0 space-y-4 text-[color:var(--lookbook-ink)]"
    >
      <div>
        <h2 className="lookbook-display text-2xl font-semibold">
          {strings.firstUse.today}
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {city ? <span>{city}</span> : null}
          <span>
            {formatPlannerTemperature(ritual.weather.current.temperature, i18n.language)}
          </span>
        </p>
      </div>
      {ritual.weather.alerts.map((alert) => (
        <details
          key={alert.start + alert.event}
          className="rounded-lg border border-amber-600/40 p-2"
        >
          <summary className="cursor-pointer font-semibold">{alert.event}</summary>
          <p className="mt-2 text-sm">{alert.description}</p>
        </details>
      ))}
      {starterOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <AddGarment strings={strings} />
          <p className="text-sm">{t('commerce.premium.planner.starterWardrobe')}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {available.map((item) => (
          <button
            key={item.scenario}
            type="button"
            onClick={() => setScenario(item.scenario)}
            aria-pressed={item.scenario === outfit.scenario}
            className="min-h-11 rounded-lg border border-[color:var(--lookbook-ink)] px-3 text-sm font-semibold aria-pressed:bg-[var(--lookbook-ink)] aria-pressed:text-[color:var(--lookbook-surface)]"
          >
            {t(`shareCard.scenarios.${item.scenario}`)}
          </button>
        ))}
      </div>
      <ul className="flex flex-wrap gap-2">
        {outfit.garmentIds.map((id) => {
          const starter = garmentCategoryEnum.options.find(
            (category) => id === `default-${category}`
          )
          const category =
            outfit.displayGarments?.find((garment) => garment.id === id)?.category ??
            starter
          return (
            <li
              key={id}
              className="rounded-lg border border-[color:var(--lookbook-line)] p-2 text-sm"
            >
              {category
                ? t(`commerce.premium.planner.garmentCategory.${category}`)
                : t('shareCard.sourceOutfit')}
            </li>
          )
        })}
      </ul>
      <p className="text-sm">{outfit.comfortNotes}</p>
      {!stale && <RitualShareCardLauncher outfit={outfit} />}
    </div>
  )
}

function MemberRitual({ owner }: { owner: string }) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const [ritual, setRitual] = useState<LiveRitual | null>(null)
  const [city, setCity] = useState<string>()
  const [failure, setFailure] = useState<'missing-city' | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const token = currentWebSessionBearer()
    if (!token || !isLiveOwner(owner)) return
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && isLiveOwner(owner)
    setBusy(true)
    void getRitualFromWeb(token, locale, controller.signal)
      .then((data) => {
        if (!current()) return
        setRitual(data)
        setFailure(null)
        const credentials = captureLocationCredentials()
        if (credentials) {
          void listLocationsFromWeb(controller.signal, credentials)
            .then((locations) => {
              if (current())
                setCity(
                  locations.find(
                    (location) => location.locationKey === data.weather.locationKey
                  )?.label
                )
            })
            .catch(() => undefined)
        }
      })
      .catch(async (error: unknown) => {
        const kind = await ritualFailure(error)
        if (!current()) return
        if (kind === 'missing-city') {
          setRitual(null)
          setCity(undefined)
        }
        setFailure(kind)
      })
      .finally(() => {
        if (current()) setBusy(false)
      })
    return () => controller.abort()
  }, [attempt, locale, owner])

  const retry = (
    <button
      type="button"
      disabled={busy}
      onClick={() => setAttempt((value) => value + 1)}
      data-testid="home-outfit-retry"
      className={linkClass}
    >
      {strings.chrome.retry}
    </button>
  )
  if (ritual?.outfits.some(usableOutfit))
    return (
      <>
        {failure === 'failed' && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status">{t('commerce.premium.planner.freshness.stale')}</p>
            {retry}
          </div>
        )}
        <LiveOutfit ritual={ritual} city={city} stale={failure === 'failed'} />
      </>
    )

  return (
    <>
      <SampleOutfit
        owner={owner}
        locale={locale}
        strings={strings}
        actions={
          failure === 'missing-city' ? (
            <Link
              className={linkClass}
              href={SET_CITY_FROM_HOME}
              data-testid="home-set-city"
            >
              {strings.firstUse.setCity}
            </Link>
          ) : failure === 'failed' ? (
            retry
          ) : null
        }
      />
      {failure === 'failed' && (
        <p role="status" className="text-sm">
          {strings.firstUse.outfitFailed}
        </p>
      )}
    </>
  )
}

function HomeRitualSession({
  session,
  demo,
}: {
  session: MemberSession
  demo: ReactNode
}) {
  const { i18n } = useTranslation(undefined, { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  useEffect(() => {
    if (session.status === 'signed_in' || session.status === 'signed_out')
      resetSampleForOwner(session.owner)
  }, [session.owner, session.status])

  if (session.status === 'signed_out') return demo
  if (session.owner && isLiveOwner(session.owner))
    return <MemberRitual key={session.owner} owner={session.owner} />
  if (session.status === 'unavailable') {
    return (
      <div role="status">
        <p>{strings.chrome.sessionUnavailable}</p>
        <button type="button" className={linkClass} onClick={session.retry}>
          {strings.chrome.retry}
        </button>
      </div>
    )
  }
  return <p role="status">{strings.chrome.checkingSession}</p>
}

export function HomeRitual({ demo }: { demo: ReactNode }) {
  return (
    <MemberScope>
      {(session) => <HomeRitualSession session={session} demo={demo} />}
    </MemberScope>
  )
}
