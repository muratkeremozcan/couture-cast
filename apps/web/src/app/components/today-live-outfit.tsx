'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GarmentWithTags,
  RitualResponse,
  SavedLookContract,
  ScenarioName,
} from '@couture/api-client/contracts/http'
import {
  applyTodaySlotEdits,
  buildTodaySaveAttempt,
  buildTodaySlots,
  formatPreviewString,
  getGuestPreviewStrings,
  getTodayOutfitStrings,
  todayLocalDate,
  todayLookNameKey,
  todayRitualAnchorDate,
  todayScenarioWeather,
  todaySlotSignature,
  todaySwapOptions,
  type TodaySlotEdits,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { formatPlannerTemperature } from '../../lib/planner'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  notifySavedLooksChanged,
  SavedLookRequestError,
} from '../../lib/saved-looks'
import { currentWebSessionBearer, isLiveScope } from '../../lib/use-web-session'
import { savedLookHref } from './looks/looks-address'
import { RitualShareCardLauncher } from './ritual-share-card-launcher'
import { SaveActionButton } from './save-feedback'
import { TodayOutfitCommerce } from './today-outfit-commerce'
import { TodayOutfitPicture } from './today-outfit-picture'

type SaveReceipt = Pick<SavedLookContract, 'id' | 'revision'>

export function TodayLiveOutfit({
  ritual,
  readAt,
  stale,
  initialScenario,
  owner,
  scope,
  wardrobe,
}: {
  ritual: RitualResponse['data']
  readAt: number
  stale: boolean
  initialScenario?: ScenarioName
  owner: string
  scope: string | null
  wardrobe: readonly GarmentWithTags[]
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const router = useRouter()
  const [selectedScenario, setScenario] = useState<ScenarioName>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [edits, setEdits] = useState<Record<string, TodaySlotEdits>>({})
  const started = useRef(new Map<string, ReturnType<typeof buildTodaySaveAttempt>>())
  const saved = useRef(new Map<string, SaveReceipt>())
  const shownOffers = useRef(new Set<string>())
  const visit = useRef<AbortController | null>(null)
  const detailsId = useId()
  const available = ritual.outfits.filter(({ garmentIds }) => garmentIds.length > 0)
  const outfit =
    available.find(
      (item) => item.scenario === (selectedScenario ?? initialScenario ?? 'morning')
    ) ?? available[0]
  const scenario = outfit?.scenario ?? 'morning'
  const weather = useMemo(
    () => todayScenarioWeather(ritual.weather, scenario, readAt),
    [ritual.weather, scenario, readAt]
  )

  useEffect(() => {
    const controller = new AbortController()
    visit.current = controller
    return () => controller.abort()
  }, [scope])

  if (!outfit) return null
  const recommendationKey = JSON.stringify([
    ritual.weather.locationKey,
    todayRitualAnchorDate(ritual.weather.timezone, readAt),
    outfit.id,
    outfit.garmentIds,
    outfit.recommendationActionsAvailable,
  ])
  const closet = outfit.recommendationActionsAvailable === false ? [] : wardrobe
  const baseSlots = buildTodaySlots(outfit, weather, closet)
  const slots = applyTodaySlotEdits(baseSlots, edits[recommendationKey], closet, weather)
  const signature = todaySlotSignature(slots)
  const wornOn = todayLocalDate(ritual.weather.timezone)
  const key = `${recommendationKey}:${wornOn}:${signature}`
  const copy = getTodayOutfitStrings(i18n.language)
  const title = copy.lookName[todayLookNameKey(weather)]
  const canUseRecommendation =
    !stale &&
    outfit.recommendationActionsAvailable !== false &&
    signature === todaySlotSignature(baseSlots)
  const strings = getGuestPreviewStrings(i18n.language)
  const live = () =>
    visit.current !== null && !visit.current.signal.aborted && isLiveScope(scope)

  return (
    <div data-testid="home-live-outfit" className="space-y-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p data-testid="today-outfit-weather-reason" className="text-sm text-ink-soft">
        {formatPreviewString(copy.weatherReason, {
          temperature: formatPlannerTemperature(weather.temperature, i18n.language),
        })}
      </p>
      <TodayOutfitPicture
        key={recommendationKey}
        slots={slots}
        strings={strings}
        locale={i18n.language}
        getOptions={(index) => todaySwapOptions(slots, index, closet, weather)}
        onChoose={(index, slot) => {
          if (!live()) return
          setEdits((previous) => ({
            ...previous,
            [recommendationKey]: {
              ...previous[recommendationKey],
              [index]: { ...slot, imageAccess: undefined },
            },
          }))
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SaveActionButton
          data-testid="today-primary-action"
          data-primary-action="true"
          data-gold="primary"
          primary
          requiresNetwork
          ownerKey={scope}
          resetKey={key}
          idleLabel={copy.wearThis}
          onSave={async () => {
            const token = currentWebSessionBearer()
            const signal = visit.current?.signal
            if (!live() || !token) return false
            const attempt =
              started.current.get(key) ??
              buildTodaySaveAttempt(outfit.id, weather.condition, slots, wornOn, title)
            started.current.set(key, attempt)
            try {
              const record = await createSavedLookFromWeb(attempt.payload, {
                accessToken: token,
                idempotencyKey: attempt.idempotencyKey,
                signal,
              })
              if (signal?.aborted || !live()) return false
              started.current.delete(key)
              saved.current.set(key, { id: record.id, revision: record.revision })
              notifySavedLooksChanged(owner)
              return true
            } catch (error) {
              if (error instanceof SavedLookRequestError && error.status === 409) {
                started.current.delete(key)
              }
              throw error
            }
          }}
          onUndo={async () => {
            const receipt = saved.current.get(key)
            const token = currentWebSessionBearer()
            const signal = visit.current?.signal
            if (!live() || !receipt || !token) return false
            try {
              await deleteSavedLookFromWeb(
                receipt.id,
                formatSavedLookIfMatch(receipt.id, receipt.revision),
                { accessToken: token, signal }
              )
            } catch (error) {
              if (!(error instanceof SavedLookRequestError && error.status === 404))
                throw error
            }
            if (signal?.aborted || !live()) return false
            saved.current.delete(key)
            notifySavedLooksChanged(owner)
            return true
          }}
          onView={() => {
            const receipt = saved.current.get(key)
            if (live() && receipt) router.push(savedLookHref(receipt.id))
          }}
        />
        <button
          type="button"
          data-testid="today-outfit-details"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold underline underline-offset-4"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t('home.today.outfitDetails')}
        </button>
      </div>
      <div id={detailsId} hidden={!detailsOpen} className="space-y-3">
        {available.length > 1 && (
          <div data-testid="home-scenario-choices" className="flex flex-wrap gap-2">
            {available.map((item) => (
              <button
                key={item.scenario}
                type="button"
                onClick={() => setScenario(item.scenario)}
                aria-pressed={item.scenario === outfit.scenario}
                className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold aria-pressed:border-inverse aria-pressed:bg-inverse aria-pressed:text-on-inverse"
              >
                {t(`shareCard.scenarios.${item.scenario}`)}
              </button>
            ))}
          </div>
        )}
        <p className="text-sm">{outfit.comfortNotes}</p>
        {outfit.reasoningBadges.map((badge) => (
          <details key={badge.key} data-testid={`reasoning-badge-${badge.key}`}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
              {badge.label}
            </summary>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {badge.bullets.map((bullet, index) => (
                <li key={index}>{bullet}</li>
              ))}
            </ul>
          </details>
        ))}
        {detailsOpen && canUseRecommendation && (
          <>
            <RitualShareCardLauncher outfit={outfit} />
            {outfit.shopThisLook && (
              <TodayOutfitCommerce
                key={outfit.id}
                outfit={outfit}
                offer={outfit.shopThisLook}
                scope={scope}
                shown={shownOffers.current}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
