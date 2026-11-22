'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  garmentCategoryEnum,
  type RitualResponse,
  type SavedLookContract,
  type ScenarioOutfit,
} from '@couture/api-client/contracts/http'
import {
  buildHomeSampleSavedLookInput,
  createAnnouncementToken,
  createIdempotencyKey,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  isOfflineError,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  savedLookMatchesHomeSample,
  savedLookToSampleBookmark,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type GuestPreviewStrings,
  type SampleGarmentCategory,
  type SampleBookmark,
  type SampleOutfitResult,
  type StatusBarNoticeInput,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { formatPlannerTemperature } from '../../lib/planner'
import { captureLocationCredentials, listLocationsFromWeb } from '../../lib/locations'
import { getRitualFromWeb, ritualFailure, SET_CITY_FROM_HOME } from '../../lib/ritual'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  listSavedLooksFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
} from '../../lib/saved-looks'
import {
  currentWebSessionBearer,
  isLiveOwner,
  MemberScope,
  type MemberSession,
} from '../../lib/use-web-session'
import { GuestPreviewOutfit } from './guest-preview/guest-preview-outfit'
import { GuestPreviewSwapDialog } from './guest-preview/guest-preview-swap-dialog'
import { SampleIdeaControls } from './guest-preview/sample-idea-controls'
import { RitualShareCardLauncher } from './ritual-share-card-launcher'
import { useStatusBar } from './save-feedback'

const linkClass =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold underline underline-offset-4'
const primaryLinkClass =
  'inline-flex min-h-11 items-center rounded-lg bg-[#111111] px-4 text-sm font-semibold text-white'

let retainedSample: { owner: string; result: SampleOutfitResult } | undefined

function resetSampleForOwner(owner: string | null) {
  if (retainedSample?.owner !== owner) retainedSample = undefined
}

function buildHomeSampleAttemptKey(
  owner: string,
  lookId: string,
  garmentsSignature: string,
  weather: string,
  payload: NonNullable<ReturnType<typeof buildHomeSampleSavedLookInput>>
): string {
  const comfortSig = payload.comfort
    ? `${payload.comfort.runsColdWarm}/${payload.comfort.windTolerance}/${payload.comfort.precipPreparedness}`
    : ''
  return `${owner}:${lookId}:${garmentsSignature}:${weather}:${payload.collection ?? ''}:${comfortSig}`
}

function AddGarment({ strings }: { strings: GuestPreviewStrings }) {
  return (
    <Link
      href="/wardrobe?entry=add"
      data-testid="home-add-garment"
      data-primary-action="true"
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
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const statusBar = useStatusBar()
  const [result, setResult] = useState(() =>
    retainedSample?.owner === owner ? retainedSample.result : createMemberSampleOutfit()
  )
  const [category, setCategory] = useState<SampleGarmentCategory | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [bookmarksPersistent, setBookmarksPersistent] = useState(true)
  const [bookmarkRevision, setBookmarkRevision] = useState(0)
  const savedLooksRef = useRef<SavedLookContract[]>([])
  savedLooksRef.current = savedLooks
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<SavedLookContract | null>(null)
  const mutationVersionRef = useRef(0)
  const bookmarkOwnerMounted = useRef(true)
  const lookUndoStackRef = useRef<SampleOutfitResult[]>([])
  const ownedNoticeIdsRef = useRef<Set<string>>(new Set())
  const noticeSeqRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar

  const readLiveOnline = () =>
    statusBarRef.current.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)

  const dismissOwnedNotices = () => {
    for (const id of ownedNoticeIdsRef.current) {
      statusBarRef.current.dismissNotice(id)
    }
    ownedNoticeIdsRef.current.clear()
  }

  const showScopedNotice = (input: StatusBarNoticeInput) => {
    if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
    const shown = statusBarRef.current.showNotice(input)
    ownedNoticeIdsRef.current.add(shown.id)
  }

  useEffect(() => {
    bookmarkOwnerMounted.current = true
    const ownedNotices = ownedNoticeIdsRef.current
    saveAttemptKeysRef.current.clear()
    lastCreatedRef.current = null
    const controller = new AbortController()
    const loadVersion = mutationVersionRef.current
    void listSavedLooksFromWeb({ source: 'home_sample', signal: controller.signal })
      .then((items) => {
        if (
          controller.signal.aborted ||
          !bookmarkOwnerMounted.current ||
          !isLiveOwner(owner) ||
          mutationVersionRef.current !== loadVersion
        )
          return
        savedLooksRef.current = items
        setSavedLooks(items)
        setBookmarksPersistent(true)
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          bookmarkOwnerMounted.current &&
          mutationVersionRef.current === loadVersion
        ) {
          setBookmarksPersistent(false)
        }
      })
    return () => {
      bookmarkOwnerMounted.current = false
      controller.abort()
      for (const id of ownedNotices) {
        statusBarRef.current.dismissNotice(id)
      }
      ownedNotices.clear()
    }
  }, [owner])

  const bookmarks: (SampleBookmark & { savedLookId?: string })[] = []
  for (const saved of savedLooks) {
    const bookmark = savedLookToSampleBookmark(saved)
    if (!bookmark) continue
    bookmarks.push({ ...bookmark, savedLookId: saved.id })
  }
  const invoker = useRef<HTMLElement | null>(null)
  const update = (next: SampleOutfitResult) => {
    if (!isLiveOwner(owner)) return
    retainedSample = { owner, result: next }
    setResult(next)
  }
  const pushUndoAndUpdate = (next: SampleOutfitResult, message: string, kind: string) => {
    if (!isLiveOwner(owner) || next === result) return
    lookUndoStackRef.current = pushLookUndoSnapshot(lookUndoStackRef.current, result)
    update(next)
    const seq = ++noticeSeqRef.current
    showScopedNotice({
      id: `sample-${owner}-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`sample-${owner}-${kind}`, seq),
      message,
      tone: 'neutral',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            const { snapshot, rest } = popLookUndoSnapshot(lookUndoStackRef.current)
            lookUndoStackRef.current = rest
            if (snapshot && isLiveOwner(owner)) {
              update(snapshot)
              const undoSeq = ++noticeSeqRef.current
              showScopedNotice({
                id: `sample-${owner}-${kind}-undo-${undoSeq}`,
                announcementId: createAnnouncementToken(
                  `sample-${owner}-${kind}-undo`,
                  undoSeq
                ),
                message: t('feedback.undone'),
                tone: 'neutral',
              })
            }
          },
        },
      ],
    })
  }
  const lookId = result.look?.id
  const currentId = result.garments.find((garment) => garment.category === category)?.id
  const garmentsSignature = result.garments.map((garment) => garment.id).join(',')
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
        onTryAnother={() =>
          pushUndoAndUpdate(
            rotateMemberSampleOutfit(result),
            t('feedback.lookUpdated'),
            'shuffle'
          )
        }
        onSwap={(slot, button) => {
          invoker.current = button
          setCategory(slot)
        }}
        onUndoSwaps={() => update(undoMemberSampleSwaps(result))}
        onReviewChoices={() => {
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(createMemberSampleOutfit())
        }}
        onResetChoices={() => {
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(createMemberSampleOutfit())
        }}
      />
      <SampleIdeaControls
        strings={strings}
        preferences={result.input.preferences}
        onPreferences={(preferences) => {
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(updateMemberSampleOutfit(result, { preferences }))
        }}
        weather={result.input.weather}
        onWeather={(weather) => {
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(updateMemberSampleOutfit(result, { weather }))
        }}
        bookmarks={bookmarks}
        persistent={bookmarksPersistent}
        lookId={lookId}
        ownerKey={owner}
        useSharedFeedback
        requiresNetwork
        saveResetKey={`${owner}:${lookId ?? 'none'}:${garmentsSignature}:${result.input.weather}:${JSON.stringify(result.input.preferences)}:${bookmarkRevision}`}
        onSave={async () => {
          if (!lookId || !bookmarkOwnerMounted.current || !isLiveOwner(owner))
            return false
          lookUndoStackRef.current = []
          const payload = buildHomeSampleSavedLookInput(result)
          if (!payload) return false
          const existingMatch = savedLooksRef.current.find((item) =>
            savedLookMatchesHomeSample(item, result)
          )
          if (existingMatch) {
            lastCreatedRef.current = null
            setBookmarksPersistent(true)
            return { saved: true, undoable: false }
          }
          const actionToken = currentWebSessionBearer() ?? undefined
          const attemptKey = buildHomeSampleAttemptKey(
            owner,
            lookId,
            garmentsSignature,
            result.input.weather,
            payload
          )
          const idempotencyKey =
            saveAttemptKeysRef.current.get(attemptKey) ?? createIdempotencyKey()
          saveAttemptKeysRef.current.set(attemptKey, idempotencyKey)
          let created: SavedLookContract
          try {
            created = await createSavedLookFromWeb(payload, {
              accessToken: actionToken,
              idempotencyKey,
            })
          } catch (error) {
            if (error instanceof SavedLookRequestError && error.status === 409) {
              saveAttemptKeysRef.current.delete(attemptKey)
              if (error.code === 'SAVED_LOOK_ALREADY_REMOVED') return false
            }
            throw error
          }
          if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return false
          saveAttemptKeysRef.current.delete(attemptKey)
          mutationVersionRef.current += 1
          lastCreatedRef.current = created
          const next = [
            created,
            ...savedLooksRef.current.filter((item) => item.id !== created.id),
          ]
          savedLooksRef.current = next
          setSavedLooks(next)
          setBookmarksPersistent(true)
          notifySavedLooksChanged(owner)
          return true
        }}
        onUndoSave={async () => {
          const created = lastCreatedRef.current
          if (!created || !bookmarkOwnerMounted.current || !isLiveOwner(owner))
            return false
          const actionToken = currentWebSessionBearer() ?? undefined
          try {
            await deleteSavedLookFromWeb(
              created.id,
              formatSavedLookIfMatch(created.id, created.revision),
              { accessToken: actionToken }
            )
          } catch (error) {
            if (!(error instanceof SavedLookRequestError && error.status === 404)) {
              throw error
            }
          }
          if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return false
          mutationVersionRef.current += 1
          lastCreatedRef.current = null
          const next = savedLooksRef.current.filter((item) => item.id !== created.id)
          savedLooksRef.current = next
          setSavedLooks(next)
          notifySavedLooksChanged(owner)
          return true
        }}
        onViewSaved={() => {
          document
            .querySelector<HTMLElement>('[data-testid="sample-saved-looks"]')
            ?.scrollIntoView?.({ block: 'nearest' })
        }}
        onOpen={(bookmark) => {
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(reopenMemberSampleOutfit(result, bookmark))
        }}
        onRemove={(id) => {
          const handleRemoveError = (error: unknown, retry: () => void) => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            const failSeq = ++noticeSeqRef.current
            const offline = isOfflineError(error) || !readLiveOnline()
            showScopedNotice({
              id: `sample-${owner}-remove-${offline ? 'offline' : 'failed'}-${failSeq}`,
              announcementId: createAnnouncementToken(
                `sample-${owner}-remove-${offline ? 'offline' : 'failed'}`,
                failSeq
              ),
              message: offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
              tone: offline ? 'offline' : 'error',
              actions: offline
                ? []
                : [
                    {
                      id: 'retry',
                      kind: 'retry',
                      label: t('feedback.retry'),
                      onPress: retry,
                    },
                  ],
            })
          }
          const runRemove = async () => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            const actionToken = currentWebSessionBearer() ?? undefined
            if (!readLiveOnline()) {
              handleRemoveError(new TypeError('Failed to fetch'), () => {
                void runRemove()
              })
              return
            }
            const target = savedLooksRef.current.find(
              (item) => item.id === id || item.lookId === id
            )
            if (!target) return
            setBookmarkRevision((value) => value + 1)
            let alreadyDeleted = false
            try {
              await deleteSavedLookFromWeb(
                target.id,
                formatSavedLookIfMatch(target.id, target.revision),
                { accessToken: actionToken }
              )
            } catch (error) {
              if (error instanceof SavedLookRequestError && error.status === 404) {
                alreadyDeleted = true
              } else {
                handleRemoveError(error, () => {
                  void runRemove()
                })
                return
              }
            }
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            mutationVersionRef.current += 1
            const next = savedLooksRef.current.filter((item) => item.id !== target.id)
            savedLooksRef.current = next
            setSavedLooks(next)
            notifySavedLooksChanged(owner)
            let undoInFlight = false
            const seq = ++noticeSeqRef.current
            showScopedNotice({
              id: `sample-${owner}-remove-${seq}`,
              announcementId: createAnnouncementToken(`sample-${owner}-remove`, seq),
              message: t('feedback.removed'),
              tone: 'neutral',
              actions: alreadyDeleted
                ? []
                : [
                    {
                      id: 'undo',
                      kind: 'undo',
                      label: t('feedback.undo'),
                      onPress: async () => {
                        if (
                          undoInFlight ||
                          !bookmarkOwnerMounted.current ||
                          !isLiveOwner(owner)
                        ) {
                          return
                        }
                        if (!readLiveOnline()) {
                          const offSeq = ++noticeSeqRef.current
                          showScopedNotice({
                            id: `sample-${owner}-remove-undo-offline-${offSeq}`,
                            announcementId: createAnnouncementToken(
                              `sample-${owner}-remove-undo-offline`,
                              offSeq
                            ),
                            message: t('feedback.offlineAction'),
                            tone: 'offline',
                            actions: [],
                          })
                          return
                        }
                        undoInFlight = true
                        try {
                          const restored = await restoreSavedLookFromWeb(target.id, {
                            accessToken: actionToken,
                          })
                          if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
                          mutationVersionRef.current += 1
                          const restoredList = [
                            restored,
                            ...savedLooksRef.current.filter(
                              (item) => item.id !== restored.id
                            ),
                          ]
                          savedLooksRef.current = restoredList
                          setSavedLooks(restoredList)
                          notifySavedLooksChanged(owner)
                          const undoSeq = ++noticeSeqRef.current
                          showScopedNotice({
                            id: `sample-${owner}-remove-undo-${undoSeq}`,
                            announcementId: createAnnouncementToken(
                              `sample-${owner}-remove-undo`,
                              undoSeq
                            ),
                            message: t('feedback.undone'),
                            tone: 'neutral',
                          })
                        } catch (undoError) {
                          if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
                          const undoSeq = ++noticeSeqRef.current
                          const offline = isOfflineError(undoError) || !readLiveOnline()
                          showScopedNotice({
                            id: `sample-${owner}-remove-undo-${offline ? 'offline' : 'failed'}-${undoSeq}`,
                            announcementId: createAnnouncementToken(
                              `sample-${owner}-remove-undo-${offline ? 'offline' : 'failed'}`,
                              undoSeq
                            ),
                            message: offline
                              ? t('feedback.offlineAction')
                              : t('feedback.saveFailed'),
                            tone: offline ? 'offline' : 'error',
                            actions: [],
                          })
                        } finally {
                          undoInFlight = false
                        }
                      },
                    },
                  ],
            })
          }
          void runRemove()
        }}
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
          if (category) {
            pushUndoAndUpdate(
              swapMemberSampleGarment(result, category, garmentId),
              t('feedback.pieceSwapped'),
              'swap'
            )
          }
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
