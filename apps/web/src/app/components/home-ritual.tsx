'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  garmentCategoryEnum,
  type RitualResponse,
  type SavedLookContract,
  type ScenarioName,
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
  sampleGarmentText,
  sampleLookText,
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
import { savedLookHref } from './looks/looks-address'
import { getI18n } from '../../i18n'
import { formatPlannerTemperature } from '../../lib/planner'
import { captureLocationCredentials, listLocationsFromWeb } from '../../lib/locations'
import { getRitualFromWeb, ritualFailure, SET_CITY_FROM_HOME } from '../../lib/ritual'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  getSavedLookFromWeb,
  listSavedLooksFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
  subscribeSavedLooksChanged,
} from '../../lib/saved-looks'
import {
  currentWebSessionBearer,
  currentWebSessionScope,
  isLiveOwner,
  isLiveScope,
  MemberScope,
  useWebSessionScope,
  type MemberSession,
} from '../../lib/use-web-session'
import { HomeCloset } from './home-closet'
import { SampleGarmentArt } from './guest-preview/sample-garment-art'
import { GuestPreviewOutfit } from './guest-preview/guest-preview-outfit'
import { GuestPreviewSwapDialog } from './guest-preview/guest-preview-swap-dialog'
import { SampleIdeaControls } from './guest-preview/sample-idea-controls'
import { RitualShareCardLauncher } from './ritual-share-card-launcher'
import { SaveFeedbackProvider, useStatusBar } from './save-feedback'
import {
  ScreenGateReport,
  useGuestFirstPaint,
  useScreenGateRead,
  useScreenGateScreen,
} from './screen-gate'
import { screenSnapshot } from '../../lib/screen-snapshot'

const linkClass =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold underline underline-offset-4'
const primaryLinkClass =
  'inline-flex min-h-11 max-w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-on-primary'

const todayCardClass =
  'min-w-0 space-y-3 rounded-xl border border-line bg-card p-4 shadow-card'
const weatherLineClass =
  'flex min-h-11 flex-wrap items-center gap-x-3 px-1 text-sm text-ink-soft'

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
  const comfort = payload.comfort!
  const comfortSig = `${comfort.runsColdWarm}/${comfort.windTolerance}/${comfort.precipPreparedness}`
  return `${owner}:${lookId}:${garmentsSignature}:${weather}:${payload.collection!}:${comfortSig}:${JSON.stringify(payload.swaps)}`
}

function mergeInitialSavedLooks(
  current: SavedLookContract[],
  fetched: SavedLookContract[],
  deletedIds: ReadonlySet<string>
): SavedLookContract[] {
  const seen = new Set(current.map((item) => item.id))
  const merged = [...current]
  for (const item of fetched) {
    if (seen.has(item.id) || deletedIds.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

async function confirmWebSavedLookExists(
  existing: SavedLookContract,
  accessToken: string | undefined,
  deletedIds: ReadonlySet<string>,
  onVerifiedUnchanged: (verified: SavedLookContract) => void
): Promise<boolean> {
  try {
    const record = await getSavedLookFromWeb(existing.id, { accessToken })
    if (deletedIds.has(record.id)) return false
    onVerifiedUnchanged(record)
    return true
  } catch (error) {
    if (error instanceof SavedLookRequestError && error.status === 404) {
      return false
    }
    throw error
  }
}

async function createWebSavedLookWithKey(
  payload: NonNullable<ReturnType<typeof buildHomeSampleSavedLookInput>>,
  attemptKey: string,
  attemptKeys: Map<string, string>,
  accessToken: string | undefined
): Promise<SavedLookContract | null> {
  const idempotencyKey = attemptKeys.get(attemptKey) ?? createIdempotencyKey()
  attemptKeys.set(attemptKey, idempotencyKey)
  try {
    const created = await createSavedLookFromWeb(payload, {
      accessToken,
      idempotencyKey,
    })
    attemptKeys.delete(attemptKey)
    return created
  } catch (error) {
    if (error instanceof SavedLookRequestError && error.status === 409) {
      attemptKeys.delete(attemptKey)
      if (error.code === 'SAVED_LOOK_ALREADY_REMOVED') return null
    }
    throw error
  }
}

function SampleOutfit(props: {
  owner: string
  locale: string
  strings: GuestPreviewStrings
  actions: ReactNode
}) {
  const { hasProvider } = useStatusBar()
  if (hasProvider) return <SampleOutfitInner {...props} />
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      <SampleOutfitInner {...props} />
    </SaveFeedbackProvider>
  )
}

function SampleOutfitInner({
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
  const router = useRouter()
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
  /** Story CC-7.12 D7: the look the last accepted save confirmed, created or existing. */
  const viewLookIdRef = useRef<string | null>(null)
  const saveRunSeqRef = useRef(0)
  const deletedIdsRef = useRef<Set<string>>(new Set())
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
    deletedIdsRef.current.clear()
    saveRunSeqRef.current += 1
    lastCreatedRef.current = null
    const controller = new AbortController()
    const loadVersion = mutationVersionRef.current
    void listSavedLooksFromWeb({ source: 'home_sample', signal: controller.signal })
      .then((items) => {
        if (
          controller.signal.aborted ||
          !bookmarkOwnerMounted.current ||
          !isLiveOwner(owner)
        )
          return
        const next =
          mutationVersionRef.current === loadVersion
            ? items
            : mergeInitialSavedLooks(savedLooksRef.current, items, deletedIdsRef.current)
        savedLooksRef.current = next
        setSavedLooks(next)
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

  useEffect(() => {
    if (!owner) return
    return subscribeSavedLooksChanged((changedOwner) => {
      if (changedOwner !== owner) return
      const refreshVersion = mutationVersionRef.current
      void listSavedLooksFromWeb({
        source: 'home_sample',
        skipLegacyImport: true,
      })
        .then((items) => {
          if (
            !bookmarkOwnerMounted.current ||
            !isLiveOwner(owner) ||
            mutationVersionRef.current !== refreshVersion
          ) {
            return
          }
          const fetchedById = new Map(items.map((item) => [item.id, item]))
          const next = [
            ...items.filter((item) => !deletedIdsRef.current.has(item.id)),
            ...savedLooksRef.current.filter(
              (item) => !fetchedById.has(item.id) && !deletedIdsRef.current.has(item.id)
            ),
          ]
          savedLooksRef.current = next
          setSavedLooks(next)
          setBookmarksPersistent(true)
        })
        .catch(() => undefined)
    })
  }, [owner])

  const bookmarks: (SampleBookmark & {
    savedLookId?: string
    needsReview?: boolean
  })[] = []
  for (const saved of savedLooks) {
    const bookmark = savedLookToSampleBookmark(saved)
    if (!bookmark) continue
    bookmarks.push({
      ...bookmark,
      savedLookId: saved.id,
      needsReview: saved.availabilityStatus === 'needs_review',
    })
  }
  const invoker = useRef<HTMLElement | null>(null)
  const update = (next: SampleOutfitResult) => {
    if (!isLiveOwner(owner)) return
    saveRunSeqRef.current += 1
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
  const editor = (
    <>
      <GuestPreviewOutfit
        nested
        result={result}
        strings={strings}
        locale={locale}
        heading={strings.firstUse.outfitIdea}
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
        nested
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
        needsReviewLabel={t('savedLooks.needsReview')}
        persistent={bookmarksPersistent}
        lookId={lookId}
        ownerKey={owner}
        useSharedFeedback
        requiresNetwork
        saveResetKey={`${owner}:${lookId ?? 'none'}:${garmentsSignature}:${result.input.weather}:${JSON.stringify(result.input.preferences)}:${bookmarkRevision}`}
        onSave={async () => {
          if (!lookId || !bookmarkOwnerMounted.current || !isLiveOwner(owner))
            return false
          const saveSeq = ++saveRunSeqRef.current
          lookUndoStackRef.current = []
          const payload = buildHomeSampleSavedLookInput(result)
          if (!payload) return false
          const actionToken = currentWebSessionBearer() ?? undefined
          const existingMatch = savedLooksRef.current.find((item) =>
            savedLookMatchesHomeSample(item, result)
          )
          if (existingMatch) {
            const checkVersion = mutationVersionRef.current
            const verified = await confirmWebSavedLookExists(
              existingMatch,
              actionToken,
              deletedIdsRef.current,
              (record) => {
                if (mutationVersionRef.current !== checkVersion) return
                const refreshed = [
                  record,
                  ...savedLooksRef.current.filter((item) => item.id !== record.id),
                ]
                savedLooksRef.current = refreshed
                setSavedLooks(refreshed)
              }
            )
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return false
            if (verified) {
              if (saveRunSeqRef.current === saveSeq) {
                lastCreatedRef.current = null
                viewLookIdRef.current = existingMatch.id
              }
              setBookmarksPersistent(true)
              return { saved: true, undoable: false }
            }
            deletedIdsRef.current.add(existingMatch.id)
            const pruned = savedLooksRef.current.filter(
              (item) => item.id !== existingMatch.id
            )
            savedLooksRef.current = pruned
            setSavedLooks(pruned)
          }
          const attemptKey = buildHomeSampleAttemptKey(
            owner,
            lookId,
            garmentsSignature,
            result.input.weather,
            payload
          )
          const created = await createWebSavedLookWithKey(
            payload,
            attemptKey,
            saveAttemptKeysRef.current,
            actionToken
          )
          if (!created || !bookmarkOwnerMounted.current || !isLiveOwner(owner)) {
            return false
          }
          deletedIdsRef.current.delete(created.id)
          mutationVersionRef.current += 1
          if (saveRunSeqRef.current === saveSeq) {
            lastCreatedRef.current = created
            viewLookIdRef.current = created.id
          }
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
          deletedIdsRef.current.add(created.id)
          mutationVersionRef.current += 1
          lastCreatedRef.current = null
          const next = savedLooksRef.current.filter((item) => item.id !== created.id)
          savedLooksRef.current = next
          setSavedLooks(next)
          notifySavedLooksChanged(owner)
          return true
        }}
        onViewSaved={() => {
          // Story CC-7.12 D7: View opens the saved look in Looks.
          // Codex #1: a save that confirmed an existing look views that look.
          const id = viewLookIdRef.current
          if (id) router.push(savedLookHref(id))
        }}
        onOpen={(bookmark) => {
          const selected = bookmark as SampleBookmark & {
            savedLookId?: string
            needsReview?: boolean
          }
          const matching = selected.savedLookId
            ? savedLooksRef.current.find((item) => item.id === selected.savedLookId)
            : savedLooksRef.current.find((item) => item.lookId === bookmark.lookId)
          if (selected.needsReview || matching?.availabilityStatus === 'needs_review') {
            const seq = ++noticeSeqRef.current
            showScopedNotice({
              id: `sample-${owner}-needs-review-${seq}`,
              announcementId: createAnnouncementToken(
                `sample-${owner}-needs-review`,
                seq
              ),
              message: t('savedLooks.needsReviewDetail'),
              tone: 'neutral',
              actions: [],
            })
            return
          }
          lookUndoStackRef.current = []
          dismissOwnedNotices()
          update(reopenMemberSampleOutfit(result, bookmark))
        }}
        onRemove={(id) => {
          const handleRemoveError = (
            kind: 'remove' | 'remove-undo',
            error: unknown,
            retry?: () => void
          ) => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            const failSeq = ++noticeSeqRef.current
            const offline = isOfflineError(error) || !readLiveOnline()
            showScopedNotice({
              id: `sample-${owner}-${kind}-${offline ? 'offline' : 'failed'}-${failSeq}`,
              announcementId: createAnnouncementToken(
                `sample-${owner}-${kind}-${offline ? 'offline' : 'failed'}`,
                failSeq
              ),
              message: offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
              tone: offline ? 'offline' : 'error',
              actions:
                !offline && retry
                  ? [
                      {
                        id: 'retry',
                        kind: 'retry',
                        label: t('feedback.retry'),
                        onPress: retry,
                      },
                    ]
                  : [],
            })
          }
          const runRemove = async () => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            const actionToken = currentWebSessionBearer() ?? undefined
            if (!readLiveOnline()) {
              handleRemoveError('remove', new TypeError('Failed to fetch'))
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
                handleRemoveError('remove', error, () => {
                  void runRemove()
                })
                return
              }
            }
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            deletedIdsRef.current.add(target.id)
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
                          handleRemoveError(
                            'remove-undo',
                            new TypeError('Failed to fetch')
                          )
                          return
                        }
                        undoInFlight = true
                        try {
                          const restored = await restoreSavedLookFromWeb(target.id, {
                            accessToken: actionToken,
                          })
                          if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
                          deletedIdsRef.current.delete(restored.id)
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
                          handleRemoveError('remove-undo', undoError)
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
    </>
  )
  return (
    <div data-testid="member-sample-outfit" className="space-y-3 text-ink">
      <p data-testid="member-sample-label" className="text-sm font-medium text-ink-soft">
        {t('home.today.sampleLook')}
      </p>
      <h2 className="text-xl font-semibold">
        {result.look
          ? sampleLookText(result.look, strings).name
          : strings.firstUse.outfitIdea}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {result.garments.map((garment) => (
          <li key={garment.id} className="rounded-md bg-page p-1">
            <SampleGarmentArt
              garment={garment}
              label={sampleGarmentText(garment, strings).description}
              className="h-11 w-11"
            />
          </li>
        ))}
      </ul>
      {actions}
      <details className="space-y-3">
        <summary
          data-testid="home-edit-sample"
          data-primary-action={actions === null ? 'true' : undefined}
          data-gold={actions === null ? 'primary' : undefined}
          className={
            actions === null
              ? `${primaryLinkClass} cursor-pointer`
              : linkClass + ' cursor-pointer'
          }
        >
          {t('home.today.editSample')}
        </summary>
        {editor}
      </details>
    </div>
  )
}

function usableOutfit(outfit: ScenarioOutfit) {
  return outfit.garmentIds.length > 0
}

type LiveRitual = RitualResponse['data']

function LiveOutfit({
  ritual,
  stale,
  initialScenario,
}: {
  ritual: LiveRitual
  stale: boolean
  initialScenario?: ScenarioName
}) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const available = ritual.outfits.filter(usableOutfit)
  const [selectedScenario, setScenario] = useState<ScenarioName>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const outfit =
    available.find(
      (item) => item.scenario === (selectedScenario ?? initialScenario ?? 'morning')
    ) ?? available[0]
  if (!outfit) return null
  const starter = outfit.garmentIds.every((id) => id.startsWith('default-'))
  return (
    <section
      data-testid="today-first-content"
      data-surface="card"
      className={todayCardClass}
    >
      <div data-testid="home-live-outfit" className="space-y-3">
        <h2 className="text-xl font-semibold">
          {t(starter ? 'home.today.starterOutfit' : 'home.today.outfit')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {outfit.garmentIds.map((id) => {
            const category =
              outfit.displayGarments?.find((garment) => garment.id === id)?.category ??
              garmentCategoryEnum.options.find((value) => id === `default-${value}`)
            return (
              <li key={id} className="rounded-md bg-page px-2 py-1 text-sm">
                {category
                  ? t(`commerce.premium.planner.garmentCategory.${category}`)
                  : t('shareCard.sourceOutfit')}
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          data-testid="today-primary-action"
          data-gold="primary"
          data-primary-action="true"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          className={primaryLinkClass}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t('home.today.outfitDetails')}
        </button>
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
          {starter && (
            <p className="text-sm">{t('commerce.premium.planner.starterWardrobe')}</p>
          )}
          <p className="text-sm">{outfit.comfortNotes}</p>
          {!stale && detailsOpen && <RitualShareCardLauncher outfit={outfit} />}
        </div>
      </div>
    </section>
  )
}

type RitualFailure = 'missing-city' | 'failed'

function SetCityAction({
  label,
  failure,
  retry,
}: {
  label: string
  failure: RitualFailure | null
  retry: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={SET_CITY_FROM_HOME}
        data-testid="home-set-city"
        data-gold="primary"
        data-primary-action="true"
        className={primaryLinkClass}
      >
        {label}
      </Link>
      {failure === 'failed' && retry}
    </div>
  )
}

/** Story CC-7.7 D5: what a return to Home shows in its first frame, per member. */
type RitualSnapshot = {
  ritual: LiveRitual | null
  city: string | undefined
  failure: RitualFailure | null
}

const RITUAL_SNAPSHOT_PART = 'ritual'

function TodayWeather({
  ritual,
  city,
  locale,
}: {
  ritual: LiveRitual | null
  city: string | undefined
  locale: string
}) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  return (
    <p data-testid="weather-header" className={weatherLineClass}>
      {ritual ? (
        <>
          {city && <span>{city}</span>}
          <span className="font-semibold text-ink">
            {formatPlannerTemperature(ritual.weather.current.temperature, locale)}
          </span>
          <span>{t(`home.today.conditions.${ritual.weather.current.condition}`)}</span>
        </>
      ) : (
        t('home.today.weatherUnavailable')
      )}
    </p>
  )
}

function MemberRitual({
  owner,
  onScopeLeft,
  scenario,
}: {
  owner: string
  scenario?: ScenarioName
  /** Re-reads the session scope above, whose key change remounts this section for it. */
  onScopeLeft: () => void
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const screen = useScreenGateScreen()
  const [start] = useState(() => {
    const scope = currentWebSessionScope()
    return {
      scope,
      snapshot: screen
        ? screenSnapshot.recall<RitualSnapshot>(scope, screen, RITUAL_SNAPSHOT_PART)
        : undefined,
    }
  })
  const snapshot = start.snapshot
  const [ritual, setRitual] = useState<LiveRitual | null>(snapshot?.ritual ?? null)
  const [city, setCity] = useState<string | undefined>(snapshot?.city)
  const [failure, setFailure] = useState<RitualFailure | null>(snapshot?.failure ?? null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(true)
  /** Codex review P2-1: the session scope of the read whose answer this section shows. */
  const shownScopeRef = useRef<string | null>(start.scope)
  /**
   * Codex review P2-4: the city line's read has answered, or none will run. The gate waits for
   * it too, so the city never lands in the visible outfit's header after the reveal.
   */
  const [cityRead, setCityRead] = useState(snapshot !== undefined)
  /** The outfit and city line on screen now, for a refresh whose city line cannot be read. */
  const shownRef = useRef({ ritual, city })
  shownRef.current = { ritual, city }
  // Story CC-7.7 D2: the ritual read has answered (an outfit, none, or a failure). Until then
  // nothing renders here, never the sample outfit: a member sees the sample only once their
  // own read settled without a usable outfit.
  const settled = ritual !== null || failure !== null
  // The gate and the snapshot share one condition, so a return never starts from an outfit
  // whose city line had not answered yet.
  const readSettled = failure !== null || (ritual !== null && cityRead)
  useScreenGateRead('ritual', readSettled)
  useEffect(() => {
    if (!screen || !readSettled) return
    // Stored under the scope its read started in: the store drops it once that scope left.
    screenSnapshot.remember(shownScopeRef.current, screen, RITUAL_SNAPSHOT_PART, {
      ritual,
      city,
      failure,
    } satisfies RitualSnapshot)
  }, [city, failure, readSettled, ritual, screen])

  useEffect(() => {
    const token = currentWebSessionBearer()
    if (!token || !isLiveOwner(owner)) return
    const scope = currentWebSessionScope()
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && isLiveOwner(owner)
    /**
     * Codex review P2-1: e2e fixture bearers share one owner, so the owner check alone would let
     * an answer read with the last fixture bearer land for the next. Such an answer is dropped,
     * and the section keyed by the scope above remounts and reads with the bearer the tab holds
     * now: one read for the new scope, never a retry here followed by the remount's own read.
     */
    const sameScope = () => {
      if (isLiveScope(scope)) return true
      onScopeLeft()
      return false
    }
    setBusy(true)
    void getRitualFromWeb(token, locale, controller.signal)
      .then((data) => {
        if (!current() || !sameScope()) return
        /*
         * CodeRabbit r2 #6: a refreshed outfit counts as settled only with its own city line.
         * The city read starts pending again, so neither the gate nor the snapshot takes the
         * new outfit with the previous one's city; the snapshot keeps the last coherent pair
         * until this one settles. The shown city line stays only for the same location.
         */
        const shown = shownRef.current
        const keptCity =
          shown.ritual?.weather.locationKey === data.weather.locationKey
            ? shown.city
            : undefined
        shownScopeRef.current = scope
        setRitual(data)
        setCity(keptCity)
        setFailure(null)
        const credentials = captureLocationCredentials()
        if (!credentials) {
          setCityRead(true)
          return
        }
        setCityRead(false)
        void listLocationsFromWeb(controller.signal, credentials)
          .then((locations) => {
            if (!current() || !sameScope()) return
            setCity(
              locations.find(
                (location) => location.locationKey === data.weather.locationKey
              )?.label
            )
            setCityRead(true)
          })
          .catch(() => {
            // No city line: the outfit shows without a new one, as before.
            if (current()) setCityRead(true)
          })
      })
      .catch(async (error: unknown) => {
        const kind = await ritualFailure(error)
        if (!current() || !sameScope()) return
        shownScopeRef.current = scope
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
  }, [attempt, locale, owner, onScopeLeft])

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
  const liveOutfit = ritual?.outfits.some(usableOutfit) ? ritual : null
  return (
    <>
      {settled && <TodayWeather ritual={ritual} city={city} locale={locale} />}
      {liveOutfit && (
        <LiveOutfit
          ritual={liveOutfit}
          initialScenario={scenario}
          stale={failure === 'failed'}
        />
      )}
      {settled && !liveOutfit && (
        <section
          data-testid="today-first-content"
          data-surface="card"
          className={todayCardClass}
        >
          <SampleOutfit
            owner={owner}
            locale={locale}
            strings={strings}
            actions={
              ritual ? null : (
                <SetCityAction
                  label={strings.firstUse.setCity}
                  failure={failure}
                  retry={retry}
                />
              )
            }
          />
        </section>
      )}
      {liveOutfit && failure === 'failed' && (
        <div
          data-testid="home-outfit-refresh-failed"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-page px-3 text-sm"
        >
          <p role="status">{t('commerce.premium.planner.freshness.stale')}</p>
          {retry}
        </div>
      )}
      {liveOutfit?.weather.alerts.map((alert) => (
        <details
          key={alert.start + alert.event}
          className="rounded-lg border border-notice-line bg-notice-surface p-2 text-notice-ink"
        >
          <summary className="cursor-pointer font-semibold">{alert.event}</summary>
          <p className="mt-2 text-sm">{alert.description}</p>
        </details>
      ))}
      {start.scope && <HomeCloset owner={owner} scope={start.scope} />}
      <Link
        href="/looks?segment=plan"
        data-testid="home-plan-week"
        className="flex min-h-touch items-center justify-between gap-2 border-b border-line py-3 text-sm font-semibold"
      >
        {t('home.today.planWeek')}
        <span aria-hidden="true">›</span>
      </Link>
    </>
  )
}

function HomeRitualSession({
  session,
  demo,
  scenario,
}: {
  session: MemberSession
  scenario?: ScenarioName
  demo: ReactNode
}) {
  const { i18n } = useTranslation(undefined, { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  const guestFirstPaint = useGuestFirstPaint()
  /*
   * CI 7.7-E2E-009 swap-while-reading on d67800d2: e2e fixture bearers share one owner, so a key
   * by owner kept member A's outfit through a switch to B. Keyed by the session scope (the owner
   * for a verified member, owner and bearer for a fixture), the switch drops A's outfit in the
   * same render, before B's reads land; a verified member's token refresh keeps the scope.
   */
  const scope = useWebSessionScope()
  // A bearer switch the bridge did not announce is found by the ritual read: it asks for a
  // render here, which reads the new scope and remounts the section under it.
  const [, rereadScope] = useReducer((tick: number) => tick + 1, 0)
  useEffect(() => {
    if (session.status === 'signed_in' || session.status === 'signed_out')
      resetSampleForOwner(session.owner)
  }, [session.owner, session.status])

  if (session.status === 'signed_out') return <DemoOutfit demo={demo} />
  if (session.owner && isLiveOwner(session.owner))
    return (
      <MemberRitual
        key={scope ?? session.owner}
        owner={session.owner}
        onScopeLeft={rereadScope}
        scenario={scenario}
      />
    )
  if (session.status === 'unavailable') {
    return (
      <div role="status">
        {/* The session check failed: its retry is this section's settled state. */}
        <ScreenGateReport read="ritual" settled />
        <ScreenGateReport read="closet" settled />
        <p>{strings.chrome.sessionUnavailable}</p>
        <button type="button" className={linkClass} onClick={session.retry}>
          {strings.chrome.retry}
        </button>
      </div>
    )
  }
  // Story CC-7.7 D1: while the session is checked, a signed-out page (`data-session="none"`)
  // already shows the demo it will keep, so nothing swaps in after the check. A page painted for
  // a stored session hides it (globals.css) and its screen gate shows the placeholder instead.
  if (guestFirstPaint) return <DemoOutfit demo={demo} guestOnly />
  return <p role="status">{strings.chrome.checkingSession}</p>
}

/** The signed-out demonstration outfit, never shown to a member (D2). */
function DemoOutfit({
  demo,
  guestOnly = false,
}: {
  demo: ReactNode
  guestOnly?: boolean
}) {
  return (
    <div
      data-testid="home-demo-outfit"
      data-landing={guestOnly ? 'guest' : undefined}
      className="flex flex-col gap-6"
    >
      {demo}
    </div>
  )
}

export function HomeRitual({
  demo,
  scenario,
}: {
  demo: ReactNode
  scenario?: ScenarioName
}) {
  return (
    <MemberScope>
      {(session) => (
        <HomeRitualSession session={session} demo={demo} scenario={scenario} />
      )}
    </MemberScope>
  )
}
