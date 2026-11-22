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
  applyBoundedListRemove,
  applyBoundedListSave,
  createAnnouncementToken,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  parseSampleBookmarks,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  saveSampleBookmark,
  swapMemberSampleGarment,
  undoBoundedListRemove,
  undoBoundedListSave,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type BoundedRemoveMutation,
  type BoundedSaveMutation,
  type GuestPreviewStrings,
  type SampleGarmentCategory,
  type SampleBookmark,
  type SampleOutfitResult,
  type StatusBarNoticeInput,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { readStorage } from '../../lib/browser-persistence'
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

type BookmarkChange = (bookmarks: SampleBookmark[]) => SampleBookmark[] | null

function replayBookmarkChanges(
  bookmarks: SampleBookmark[],
  changes: Iterable<BookmarkChange>
): { next: SampleBookmark[]; aborted: boolean } {
  let current = bookmarks
  for (const change of changes) {
    const result = change(current)
    if (result === null) return { next: current, aborted: true }
    current = result
  }
  return { next: current, aborted: false }
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
  const bookmarkKey = `couturecast.member-sample-bookmarks.${owner}`
  const [bookmarks, setBookmarks] = useState(() =>
    parseSampleBookmarks(readStorage('local', bookmarkKey), SAMPLE_CATALOG)
  )
  const [bookmarksPersistent, setBookmarksPersistent] = useState(true)
  const [bookmarkRevision, setBookmarkRevision] = useState(0)
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  const lastSavedMutationRef = useRef<BoundedSaveMutation<SampleBookmark> | null>(null)
  const storedBookmarks = useRef(bookmarks)
  const pendingBookmarkChanges = useRef(new Map<string, BookmarkChange>())
  const bookmarkOwnerMounted = useRef(true)
  const lookUndoStackRef = useRef<SampleOutfitResult[]>([])
  const ownedNoticeIdsRef = useRef<Set<string>>(new Set())
  const noticeSeqRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar

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
    const onStorage = (event: StorageEvent) => {
      if (!isLiveOwner(owner) || (event.key !== null && event.key !== bookmarkKey)) return
      try {
        const storage = window.localStorage
        if (event.storageArea !== storage) return
        const stored = parseSampleBookmarks(storage.getItem(bookmarkKey), SAMPLE_CATALOG)
        const pending = pendingBookmarkChanges.current
        storedBookmarks.current = stored
        const replayed = replayBookmarkChanges(stored, pending.values())
        bookmarksRef.current = replayed.next
        setBookmarks(replayed.next)
        setBookmarksPersistent(pending.size === 0)
      } catch {
        setBookmarksPersistent(false)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      bookmarkOwnerMounted.current = false
      window.removeEventListener('storage', onStorage)
      for (const id of ownedNotices) {
        statusBarRef.current.dismissNotice(id)
      }
      ownedNotices.clear()
    }
  }, [bookmarkKey, owner])

  const updateBookmarks = (
    lookId: string,
    change: BookmarkChange,
    options?: { allowConflictAbort?: boolean }
  ): boolean | Promise<boolean> => {
    const apply = (): boolean => {
      if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return false
      // Snapshot the prior queue before mutating so conflict aborts or failed undo writes
      // restore the exact preceding queue order without stranding a failed undo.
      const pending = pendingBookmarkChanges.current
      const priorQueue = new Map(pending)
      pending.delete(lookId)
      pending.set(lookId, change)
      let next: SampleBookmark[]
      let aborted = false
      let failedWrite = false
      try {
        const storage = window.localStorage
        const stored = parseSampleBookmarks(storage.getItem(bookmarkKey), SAMPLE_CATALOG)
        storedBookmarks.current = stored
        const replayed = replayBookmarkChanges(stored, pending.values())
        if (replayed.aborted) {
          aborted = true
          pendingBookmarkChanges.current = priorQueue
          next = replayBookmarkChanges(stored, priorQueue.values()).next
        } else {
          next = replayed.next
          storage.setItem(bookmarkKey, JSON.stringify(next))
          storedBookmarks.current = next
          pending.clear()
        }
      } catch {
        failedWrite = true
        if (options?.allowConflictAbort) {
          pendingBookmarkChanges.current = priorQueue
        }
        const replayed = replayBookmarkChanges(
          storedBookmarks.current,
          pendingBookmarkChanges.current.values()
        )
        next = replayed.next
      }
      bookmarksRef.current = next
      setBookmarks(next)
      const persisted =
        !aborted && !failedWrite && pendingBookmarkChanges.current.size === 0
      if (!aborted) {
        setBookmarksPersistent(persisted)
      }
      return persisted
    }
    if (navigator.locks) {
      return navigator.locks.request(bookmarkKey, apply).catch(apply)
    }
    return apply()
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
        saveResetKey={`${owner}:${lookId ?? 'none'}:${garmentsSignature}:${bookmarkRevision}`}
        onSave={() => {
          if (!lookId) return false
          lookUndoStackRef.current = []
          const [entry] = saveSampleBookmark([], result)
          if (!entry) return false
          return updateBookmarks(lookId, (current) => {
            const mutation = applyBoundedListSave({
              entries: current,
              entry,
              getKey: (bookmark) => bookmark.lookId,
            })
            lastSavedMutationRef.current = mutation
            return mutation.next
          })
        }}
        onUndoSave={() => {
          if (!lookId) return false
          const captured = lastSavedMutationRef.current
          if (!captured || captured.savedKey !== lookId) return false
          return updateBookmarks(
            lookId,
            (current) => {
              const undone = undoBoundedListSave({
                entries: current,
                mutation: captured,
                getKey: (bookmark) => bookmark.lookId,
                isSameEntry: (a, b) => JSON.stringify(a) === JSON.stringify(b),
              })
              return undone.ok ? undone.next : null
            },
            { allowConflictAbort: true }
          )
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
          const runRemove = () => {
            if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
            let removedMutation: BoundedRemoveMutation<SampleBookmark> | null = null
            setBookmarkRevision((value) => value + 1)
            const outcome = updateBookmarks(id, (current) => {
              removedMutation = applyBoundedListRemove({
                entries: current,
                key: id,
                getKey: (bookmark) => bookmark.lookId,
              })
              return removedMutation ? removedMutation.next : current
            })
            const handleSettled = (ok: boolean) => {
              if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
              if (!ok) {
                const failSeq = ++noticeSeqRef.current
                showScopedNotice({
                  id: `sample-${owner}-remove-failed-${failSeq}`,
                  announcementId: createAnnouncementToken(
                    `sample-${owner}-remove-failed`,
                    failSeq
                  ),
                  message: t('feedback.saveFailed'),
                  tone: 'error',
                  actions: [
                    {
                      id: 'retry',
                      kind: 'retry',
                      label: t('feedback.retry'),
                      onPress: () => runRemove(),
                    },
                  ],
                })
                return
              }
              const capturedRemoval = removedMutation
              if (!capturedRemoval) return
              const seq = ++noticeSeqRef.current
              showScopedNotice({
                id: `sample-${owner}-remove-${seq}`,
                announcementId: createAnnouncementToken(`sample-${owner}-remove`, seq),
                message: t('feedback.removed'),
                tone: 'neutral',
                actions: [
                  {
                    id: 'undo',
                    kind: 'undo',
                    label: t('feedback.undo'),
                    onPress: () => {
                      if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
                      const restoreOutcome = updateBookmarks(
                        id,
                        (current) => {
                          const undone = undoBoundedListRemove({
                            entries: current,
                            mutation: capturedRemoval,
                            getKey: (bookmark) => bookmark.lookId,
                          })
                          return undone.ok ? undone.next : null
                        },
                        { allowConflictAbort: true }
                      )
                      const finishUndo = (restoredOk: boolean) => {
                        if (!bookmarkOwnerMounted.current || !isLiveOwner(owner)) return
                        const undoSeq = ++noticeSeqRef.current
                        if (restoredOk) {
                          showScopedNotice({
                            id: `sample-${owner}-remove-undo-${undoSeq}`,
                            announcementId: createAnnouncementToken(
                              `sample-${owner}-remove-undo`,
                              undoSeq
                            ),
                            message: t('feedback.undone'),
                            tone: 'neutral',
                          })
                        } else {
                          showScopedNotice({
                            id: `sample-${owner}-remove-undo-failed-${undoSeq}`,
                            announcementId: createAnnouncementToken(
                              `sample-${owner}-remove-undo-failed`,
                              undoSeq
                            ),
                            message: t('feedback.saveFailed'),
                            tone: 'error',
                          })
                        }
                      }
                      if (
                        restoreOutcome &&
                        typeof (restoreOutcome as Promise<boolean>).then === 'function'
                      ) {
                        void (restoreOutcome as Promise<boolean>).then(finishUndo)
                      } else {
                        finishUndo(Boolean(restoreOutcome))
                      }
                    },
                  },
                ],
              })
            }
            if (outcome && typeof (outcome as Promise<boolean>).then === 'function') {
              void (outcome as Promise<boolean>).then(handleSettled)
            } else {
              handleSettled(Boolean(outcome))
            }
          }
          runRemove()
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
