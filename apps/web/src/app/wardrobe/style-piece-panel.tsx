'use client'

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { withRequestDeadline } from '@couture/api-client'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import {
  applyBoundedListRemove,
  applyBoundedListSave,
  createAnnouncementToken,
  createStylePieceRefresh,
  formatPreviewString,
  formatSampleTemperature,
  getGuestPreviewStrings,
  getStylePieceStrings,
  initialStylePieceWeather,
  isOfflineError,
  isStylePieceTagged,
  parseStylePieceRecipes,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  sampleGarmentText,
  SAMPLE_WEATHER,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceLooks,
  stylePieceRecipeKey,
  stylePieceStorageKey,
  stylePieceSwapOptions,
  undoBoundedListRemove,
  undoBoundedListSave,
  visibleStylePieceLooks,
  type BoundedRemoveMutation,
  type BoundedSaveMutation,
  type SampleGarmentCategory,
  type StylePieceWeatherKey,
  type StylePieceLook,
  type StylePieceAnchor,
  type StylePiecePhotoAnchor,
  type StylePieceSelection,
  type StylePieceRecipe,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { onWebSessionIdentity } from '../../lib/web-session'
import { currentWebSessionOwner } from '../../lib/use-web-session'
import { AccessibleModal } from '../components/accessible-modal'
import { SampleGarmentArt } from '../components/guest-preview/sample-garment-art'
import {
  SaveActionButton,
  SaveFeedbackProvider,
  useStatusBar,
} from '../components/save-feedback'

type InventoryRefresh = ReturnType<typeof createStylePieceRefresh>
type Labels = ReturnType<typeof getStylePieceStrings>
type SampleLabels = ReturnType<typeof getGuestPreviewStrings>

const button =
  'min-h-11 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600 disabled:opacity-60 dark:border-zinc-600'
const action = 'min-h-11 rounded-lg px-2 text-sm font-semibold underline'

export function StylePieceEntry({
  garment,
  owner,
  unavailable,
  loading,
  labels,
  onRefresh,
  onOpen,
}: {
  garment: GarmentItemContract
  owner: string | null
  unavailable: boolean
  loading: boolean
  labels: Labels
  onRefresh: () => void
  onOpen: (selection: StylePieceSelection, button: HTMLButtonElement) => void
}) {
  if (!owner || !isStylePieceTagged(garment)) return null
  const needsRefresh = unavailable || !stylePieceAnchor(garment)
  return (
    <button
      type="button"
      data-testid={needsRefresh ? 'style-piece-refresh' : 'style-piece-open'}
      className="min-h-11 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold disabled:opacity-60 dark:border-zinc-700"
      disabled={needsRefresh && loading}
      onClick={(event) => {
        if (currentWebSessionOwner() !== owner) return
        if (unavailable || !stylePieceAnchor(garment)) onRefresh()
        else {
          const { id, category, comfortRange } = garment
          onOpen({ id, category, comfortRange }, event.currentTarget)
        }
      }}
    >
      {needsRefresh ? labels.refreshPhoto : labels.start}
    </button>
  )
}

export function StylePiecePanel({
  selection,
  inWardrobe,
  loadInventory,
  owner,
  locale,
  invoker,
  onClose,
}: {
  selection: StylePieceSelection
  inWardrobe: boolean
  loadInventory: (signal: AbortSignal) => Promise<GarmentItemContract[] | null>
  owner: string
  locale: string
  invoker: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const labels = getStylePieceStrings(locale)
  const samples = getGuestPreviewStrings(locale)
  const [{ anchor, piece }, setInventoryView] = useState<{
    anchor?: StylePiecePhotoAnchor | null
    piece: StylePieceAnchor
  }>({ piece: selection })
  const refreshRef = useRef<InventoryRefresh | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<{ id: string; look?: string; label: string | null } | null>(
    null
  )

  useLayoutEffect(() => {
    const isCurrent = () => currentWebSessionOwner() === owner
    const inventory = createStylePieceRefresh({
      garmentId: selection.id,
      load: (signal) => withRequestDeadline(15_000, [signal], loadInventory),
      isCurrent,
      onAnchor: (next) => {
        const panel = panelRef.current
        const focused = document.activeElement
        if (
          next === undefined &&
          panel &&
          focused instanceof HTMLElement &&
          focused !== panel &&
          panel.contains(focused)
        ) {
          const id = focused.dataset.testid
          restoreFocus.current = id
            ? {
                id,
                look: focused.closest<HTMLElement>('[data-style-look]')?.dataset
                  .styleLook,
                label: focused.getAttribute('aria-label'),
              }
            : null
          panel.focus()
        }
        setInventoryView((view) => ({
          anchor: next,
          piece: next
            ? { category: next.category, comfortRange: next.comfortRange }
            : view.piece,
        }))
      },
    })
    refreshRef.current = inventory
    const show = () => {
      const visible = document.visibilityState !== 'hidden'
      inventory.setVisible(visible)
      if (visible) void inventory.refresh()
    }
    const hide = () => inventory.setVisible(false)
    const unsubscribe = onWebSessionIdentity(() => {
      if (!isCurrent()) {
        inventory.stop()
        setInventoryView((view) => ({ ...view, anchor: undefined }))
      }
    })
    document.addEventListener('visibilitychange', show)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    window.addEventListener('focus', show)
    show()
    return () => {
      inventory.stop()
      refreshRef.current = null
      unsubscribe()
      document.removeEventListener('visibilitychange', show)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      window.removeEventListener('focus', show)
    }
  }, [loadInventory, owner, selection.id])

  useLayoutEffect(() => {
    if (anchor === undefined && inWardrobe) return
    const target = restoreFocus.current
    restoreFocus.current = null
    const panel = panelRef.current
    if (!anchor || !inWardrobe || !target || !panel || document.activeElement !== panel)
      return
    const previous = Array.from(
      panel.querySelectorAll<HTMLElement>('[data-testid]')
    ).find(
      (element) =>
        element.dataset.testid === target.id &&
        element.closest<HTMLElement>('[data-style-look]')?.dataset.styleLook ===
          target.look &&
        element.getAttribute('aria-label') === target.label
    )
    previous?.focus()
  }, [anchor, inWardrobe])

  return (
    <AccessibleModal
      isOpen
      onClose={() => {
        refreshRef.current?.stop()
        onClose()
      }}
      titleId="style-piece-heading"
      title={labels.start}
      closeLabel={samples.chrome.close}
      invokingElementRef={invoker}
      fallbackFocusSelector="[data-testid='garment-capture-open']"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="group"
        aria-labelledby="style-piece-heading"
        data-testid="style-piece-panel"
        onBlur={(event) => {
          if (event.target === event.currentTarget) restoreFocus.current = null
        }}
      >
        <SaveFeedbackProvider inline renderOfflineLine>
          <StylePieceIdeas
            key={JSON.stringify([selection.id, piece.category, piece.comfortRange])}
            anchor={inWardrobe ? anchor : null}
            piece={piece}
            refreshRef={refreshRef}
            owner={owner}
            garmentId={selection.id}
            locale={locale}
            labels={labels}
            samples={samples}
          />
        </SaveFeedbackProvider>
      </div>
    </AccessibleModal>
  )
}

function StylePieceUnavailable({
  labels,
  onRetry,
  retrying,
}: {
  labels: Labels
  onRetry: () => void
  retrying: boolean
}) {
  const status = useRef<HTMLParagraphElement | null>(null)
  useLayoutEffect(() => status.current?.focus(), [])
  return (
    <div className="mt-4 space-y-3">
      <p
        ref={status}
        tabIndex={-1}
        role="alert"
        data-testid="style-piece-unavailable"
        className="text-sm"
      >
        {labels.photo}
      </p>
      <button
        type="button"
        data-testid="style-piece-refresh"
        className={button}
        aria-disabled={retrying}
        onClick={onRetry}
      >
        {labels.refreshPhoto}
      </button>
    </div>
  )
}

function StylePieceIdeas({
  anchor,
  piece,
  refreshRef,
  owner,
  garmentId,
  locale,
  labels,
  samples,
}: {
  anchor: StylePiecePhotoAnchor | null | undefined
  piece: StylePieceAnchor
  refreshRef: RefObject<InventoryRefresh | null>
  owner: string
  garmentId: string
  locale: string
  labels: Labels
  samples: SampleLabels
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const statusBar = useStatusBar()
  const { category, comfortRange } = piece
  const photo = anchor?.photo
  const key = stylePieceStorageKey(owner, garmentId)
  const [weather, setWeather] = useState<StylePieceWeatherKey>(() =>
    initialStylePieceWeather(piece)
  )
  const [edits, setEdits] = useState<Record<string, StylePieceRecipe>>({})
  const [reopened, setReopened] = useState<string>()
  const [latestEdit, setLatestEdit] = useState<string>()
  const [saved, setSaved] = useState<StylePieceLook[]>([])
  const [savedResetNonce, setSavedResetNonce] = useState(0)
  const [storage, setStorage] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string>()
  const photoFailed = failedPhotoUrl !== undefined && failedPhotoUrl === photo?.url
  const [retrying, setRetrying] = useState(false)
  const authorized = Boolean(anchor) && !photoFailed
  const weatherRef = useRef<HTMLButtonElement | null>(null)
  const currentLookHeading = useRef<HTMLHeadingElement | null>(null)
  const savedSectionRef = useRef<HTMLElement | null>(null)
  const swapUndoStackRef = useRef<Record<string, StylePieceRecipe>[]>([])
  const swapRevisionRef = useRef(0)
  const lastSavedMutationRef = useRef<
    Record<string, BoundedSaveMutation<StylePieceLook>>
  >({})
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const noticeSeqRef = useRef(0)
  const draftRevision = useRef(0)
  const focusAfterRetry = useRef(false)
  const readLiveOnline = () =>
    statusBarRef.current.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)

  useLayoutEffect(() => {
    if (retrying || !focusAfterRetry.current) return
    focusAfterRetry.current = false
    if (authorized) weatherRef.current?.focus()
  }, [authorized, retrying])

  useEffect(() => {
    if (!authorized) return
    const read = () => {
      if (!refreshRef.current?.currentAnchor() || currentWebSessionOwner() !== owner)
        return
      try {
        setSaved(
          parseStylePieceRecipes(localStorage.getItem(key), { category, comfortRange })
        )
        setStorage('ready')
      } catch {
        setStorage('unavailable')
      }
    }
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === key) read()
    }
    read()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [authorized, category, comfortRange, key, owner, refreshRef])

  const currentPiece = (inventory: InventoryRefresh | null) => {
    const fresh = inventory?.currentAnchor()
    return fresh?.category === category && fresh.comfortRange === comfortRange
      ? fresh
      : null
  }

  const updateSaved = async (
    update: (entries: StylePieceLook[]) => StylePieceLook[] | null
  ) => {
    const inventory = refreshRef.current
    const refreshResult = await inventory?.refreshForAction()
    if (!refreshResult || refreshResult.status === 'revoked') return false
    if (refreshResult.status === 'error') throw refreshResult.error
    const apply = () => {
      const fresh = currentPiece(inventory)
      if (!fresh) return false
      try {
        const current = parseStylePieceRecipes(localStorage.getItem(key), fresh)
        const next = update(current)
        if (next === null) return false
        if (next.length)
          localStorage.setItem(key, JSON.stringify(next.map(({ recipe }) => recipe)))
        else localStorage.removeItem(key)
        setSaved(next)
        setStorage('ready')
        return true
      } catch {
        setStorage('unavailable')
        return false
      }
    }
    let entered = false
    try {
      const locks = navigator.locks
      if (!locks) return apply()
      return await locks.request(key, () => {
        entered = true
        return apply()
      })
    } catch {
      return entered ? false : apply()
    }
  }

  const retryPhoto = async () => {
    if (retrying) return
    setRetrying(true)
    const inventory = refreshRef.current
    if ((await inventory?.refresh()) && inventory?.currentAnchor()) {
      focusAfterRetry.current = true
      setFailedPhotoUrl((failed) => (failed === failedPhotoUrl ? undefined : failed))
    }
    setRetrying(false)
  }

  const changeWeather = (value: StylePieceWeatherKey) => {
    if (value === weather) return
    draftRevision.current += 1
    swapUndoStackRef.current = []
    setWeather(value)
    setEdits({})
    setLatestEdit(undefined)
    setReopened(undefined)
    statusBar.dismissNotice()
  }

  const openSaved = async (entry: StylePieceLook) => {
    const revision = ++draftRevision.current
    const inventory = refreshRef.current
    if (!(await inventory?.refresh()) || draftRevision.current !== revision) return
    const fresh = currentPiece(inventory)
    if (!fresh) return
    let recipe: StylePieceRecipe | undefined
    try {
      recipe = parseStylePieceRecipes(localStorage.getItem(key), fresh).find(
        (item) => stylePieceRecipeKey(item.recipe) === stylePieceRecipeKey(entry.recipe)
      )?.recipe
    } catch {
      setStorage('unavailable')
    }
    if (!recipe) return
    swapUndoStackRef.current = []
    statusBar.dismissNotice()
    setWeather(recipe.weather)
    setEdits({ [recipe.lookId]: recipe })
    setReopened(recipe.lookId)
    setLatestEdit(recipe.lookId)
    requestAnimationFrame(() => {
      if (draftRevision.current === revision && currentPiece(inventory))
        currentLookHeading.current?.focus()
    })
  }

  if (anchor === undefined)
    return (
      <p role="status" className="mt-4 text-sm">
        {labels.checkingPhoto}
      </p>
    )
  if (!photo || photoFailed)
    return (
      <StylePieceUnavailable
        labels={labels}
        retrying={retrying}
        onRetry={() => void retryPhoto()}
      />
    )

  const result = stylePieceLooks(piece, weather)
  const looks = visibleStylePieceLooks(result.looks, edits, {
    reopenedLookId: reopened,
    editedLookId: latestEdit,
  })
  const weatherName = (value: StylePieceWeatherKey) => samples.values.weather[value]
  const emptyMessage = {
    protection: labels.protection,
    comfort: labels.comfort,
    'no-looks': labels.noLooks,
  }
  const error = result.reason && emptyMessage[result.reason]
  const anchorPhoto = (
    <figure className="w-24 shrink-0">
      {/* A signed wardrobe URL is rendered directly and never passed to an image proxy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={photo.url}
        src={photo.url}
        alt={labels.anchor}
        referrerPolicy="no-referrer"
        data-testid="style-piece-anchor"
        onError={() => {
          if (refreshRef.current?.currentAnchor()?.photo.url === photo.url)
            setFailedPhotoUrl(photo.url)
        }}
        className="aspect-[3/4] w-full rounded-lg object-cover"
      />
      <figcaption className="mt-1 text-sm font-semibold">{labels.anchor}</figcaption>
    </figure>
  )

  return (
    <div className="mt-4 space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{labels.weather}</legend>
        <div className="flex flex-wrap gap-2">
          {STYLE_PIECE_WEATHER_KEYS.map((value) => (
            <button
              key={value}
              ref={value === weather ? weatherRef : undefined}
              type="button"
              data-testid={`style-piece-weather-${value}`}
              aria-pressed={weather === value}
              className={`${button} aria-pressed:border-gold-600 aria-pressed:bg-gold-500/15`}
              onClick={() => changeWeather(value)}
            >
              {weatherName(value)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {formatSampleTemperature(SAMPLE_WEATHER[weather].feelsLike, locale)}
        </p>
      </fieldset>

      {error && (
        <p role="status" className="text-sm">
          {error}
        </p>
      )}
      {error && anchorPhoto}

      {looks.map((look, index) => {
        const recipeKey = stylePieceRecipeKey(look.recipe)
        const compositionKey = look.companions
          .map((item) => `${item.category}=${item.id}`)
          .join(',')
        return (
          <StylePieceCard
            key={recipeKey}
            look={look}
            index={index}
            owner={owner}
            compositionKey={compositionKey}
            resetNonce={savedResetNonce}
            headingRef={index === 0 ? currentLookHeading : undefined}
            anchorPhoto={anchorPhoto}
            labels={labels}
            samples={samples}
            canSave={storage === 'ready'}
            onSave={async () => {
              const startSwapRevision = swapRevisionRef.current
              let captured: BoundedSaveMutation<StylePieceLook> | undefined
              const savedOk = await updateSaved((current) => {
                captured = applyBoundedListSave({
                  entries: current,
                  entry: look,
                  getKey: (item) => stylePieceRecipeKey(item.recipe),
                })
                return captured.next
              })
              if (savedOk) {
                if (captured) {
                  lastSavedMutationRef.current[recipeKey] = captured
                }
                if (swapRevisionRef.current === startSwapRevision) {
                  swapUndoStackRef.current = []
                }
              }
              return savedOk
            }}
            onUndoSave={() => {
              const captured = lastSavedMutationRef.current[recipeKey]
              if (!captured) return Promise.resolve(false)
              return updateSaved((current) => {
                const undone = undoBoundedListSave({
                  entries: current,
                  mutation: captured,
                  getKey: (item) => stylePieceRecipeKey(item.recipe),
                  isSameEntry: (a, b) =>
                    JSON.stringify(a.recipe) === JSON.stringify(b.recipe),
                })
                return undone.ok ? undone.next : null
              })
            }}
            onViewSaved={() => {
              savedSectionRef.current?.scrollIntoView?.({ block: 'nearest' })
              savedSectionRef.current?.focus()
            }}
            onSwap={(category, id) => {
              draftRevision.current += 1
              swapRevisionRef.current += 1
              swapUndoStackRef.current = pushLookUndoSnapshot(
                swapUndoStackRef.current,
                edits
              )
              setLatestEdit(look.recipe.lookId)
              setEdits((current) => ({
                ...current,
                [look.recipe.lookId]: {
                  ...look.recipe,
                  swaps: { ...look.recipe.swaps, [category]: id },
                },
              }))
              const seq = ++noticeSeqRef.current
              statusBar.showNotice({
                id: `style-piece-swap-${seq}`,
                announcementId: createAnnouncementToken('style-piece-swap', seq),
                message: t('feedback.pieceSwapped'),
                tone: 'neutral',
                actions: [
                  {
                    id: 'undo',
                    kind: 'undo',
                    label: t('feedback.undo'),
                    onPress: () => {
                      const { snapshot, rest } = popLookUndoSnapshot(
                        swapUndoStackRef.current
                      )
                      swapUndoStackRef.current = rest
                      if (snapshot !== undefined) {
                        draftRevision.current += 1
                        swapRevisionRef.current += 1
                        setEdits(snapshot)
                        const undoSeq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `style-piece-swap-undo-${undoSeq}`,
                          announcementId: createAnnouncementToken(
                            'style-piece-swap-undo',
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
            }}
          />
        )
      })}

      {storage === 'unavailable' && (
        <p role="alert" className="text-sm">
          {labels.storage}
        </p>
      )}
      {saved.length > 0 && (
        <section
          ref={savedSectionRef}
          tabIndex={-1}
          aria-label={labels.saved}
          className="space-y-2"
        >
          <h3 className="text-sm font-semibold">{labels.saved}</h3>
          {saved.map((entry) => {
            const id = stylePieceRecipeKey(entry.recipe)
            const description = [
              weatherName(entry.recipe.weather),
              ...entry.companions.map((item) => sampleGarmentText(item, samples).name),
            ].join(' · ')
            return (
              <div
                key={id}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <p className="text-sm">{description}</p>
                <div className="flex flex-wrap gap-x-2">
                  <button
                    type="button"
                    className={action}
                    data-testid="style-piece-reopen"
                    aria-label={`${labels.reopen}: ${description}`}
                    onClick={() => void openSaved(entry)}
                  >
                    {labels.reopen}
                  </button>
                  <button
                    type="button"
                    className={action}
                    data-testid="style-piece-remove"
                    aria-label={`${labels.remove}: ${description}`}
                    disabled={storage !== 'ready'}
                    onClick={() => {
                      const runRemove = async () => {
                        if (!readLiveOnline()) {
                          const seq = ++noticeSeqRef.current
                          statusBarRef.current.showNotice({
                            id: `style-piece-remove-offline-${seq}`,
                            announcementId: createAnnouncementToken(
                              'style-piece-remove-offline',
                              seq
                            ),
                            message: t('feedback.offlineAction'),
                            tone: 'offline',
                            actions: [],
                          })
                          return
                        }
                        let removedMutation: BoundedRemoveMutation<StylePieceLook> | null =
                          null
                        let removed = false
                        try {
                          removed = await updateSaved((current) => {
                            removedMutation = applyBoundedListRemove({
                              entries: current,
                              key: id,
                              getKey: (item) => stylePieceRecipeKey(item.recipe),
                            })
                            return removedMutation ? removedMutation.next : null
                          })
                        } catch (error) {
                          const errSeq = ++noticeSeqRef.current
                          if (isOfflineError(error) || !readLiveOnline()) {
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-offline-${errSeq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-offline',
                                errSeq
                              ),
                              message: t('feedback.offlineAction'),
                              tone: 'offline',
                              actions: [],
                            })
                          } else {
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-failed-${errSeq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-failed',
                                errSeq
                              ),
                              message: t('feedback.saveFailed'),
                              tone: 'error',
                              actions: [
                                {
                                  id: 'retry',
                                  kind: 'retry',
                                  label: t('feedback.retry'),
                                  onPress: () => {
                                    void runRemove()
                                  },
                                },
                              ],
                            })
                          }
                          return
                        }
                        if (!removed) {
                          if (refreshRef.current?.currentAnchor()) {
                            const failSeq = ++noticeSeqRef.current
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-failed-${failSeq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-failed',
                                failSeq
                              ),
                              message: t('feedback.saveFailed'),
                              tone: 'error',
                              actions: [
                                {
                                  id: 'retry',
                                  kind: 'retry',
                                  label: t('feedback.retry'),
                                  onPress: () => {
                                    void runRemove()
                                  },
                                },
                              ],
                            })
                          }
                          return
                        }
                        setSavedResetNonce((value) => value + 1)
                        weatherRef.current?.focus()
                        const capturedRemoval = removedMutation
                        const seq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `style-piece-remove-${seq}`,
                          announcementId: createAnnouncementToken(
                            'style-piece-remove',
                            seq
                          ),
                          message: t('feedback.removed'),
                          tone: 'neutral',
                          actions: capturedRemoval
                            ? [
                                {
                                  id: 'undo',
                                  kind: 'undo',
                                  label: t('feedback.undo'),
                                  onPress: async () => {
                                    if (!readLiveOnline()) {
                                      const offSeq = ++noticeSeqRef.current
                                      statusBarRef.current.showNotice({
                                        id: `style-piece-remove-undo-offline-${offSeq}`,
                                        announcementId: createAnnouncementToken(
                                          'style-piece-remove-undo-offline',
                                          offSeq
                                        ),
                                        message: t('feedback.offlineAction'),
                                        tone: 'offline',
                                        actions: [],
                                      })
                                      return
                                    }
                                    let restored = false
                                    try {
                                      restored = await updateSaved((current) => {
                                        const undone = undoBoundedListRemove({
                                          entries: current,
                                          mutation: capturedRemoval,
                                          getKey: (item) =>
                                            stylePieceRecipeKey(item.recipe),
                                        })
                                        return undone.ok ? undone.next : null
                                      })
                                    } catch (error) {
                                      const errSeq = ++noticeSeqRef.current
                                      if (isOfflineError(error) || !readLiveOnline()) {
                                        statusBarRef.current.showNotice({
                                          id: `style-piece-remove-undo-offline-${errSeq}`,
                                          announcementId: createAnnouncementToken(
                                            'style-piece-remove-undo-offline',
                                            errSeq
                                          ),
                                          message: t('feedback.offlineAction'),
                                          tone: 'offline',
                                          actions: [],
                                        })
                                      } else {
                                        statusBarRef.current.showNotice({
                                          id: `style-piece-remove-undo-failed-${errSeq}`,
                                          announcementId: createAnnouncementToken(
                                            'style-piece-remove-undo-failed',
                                            errSeq
                                          ),
                                          message: t('feedback.saveFailed'),
                                          tone: 'error',
                                        })
                                      }
                                      return
                                    }
                                    const undoSeq = ++noticeSeqRef.current
                                    if (restored) {
                                      statusBarRef.current.showNotice({
                                        id: `style-piece-remove-undo-${undoSeq}`,
                                        announcementId: createAnnouncementToken(
                                          'style-piece-remove-undo',
                                          undoSeq
                                        ),
                                        message: t('feedback.undone'),
                                        tone: 'neutral',
                                      })
                                    } else {
                                      statusBarRef.current.showNotice({
                                        id: `style-piece-remove-undo-failed-${undoSeq}`,
                                        announcementId: createAnnouncementToken(
                                          'style-piece-remove-undo-failed',
                                          undoSeq
                                        ),
                                        message: t('feedback.saveFailed'),
                                        tone: 'error',
                                      })
                                    }
                                  },
                                },
                              ]
                            : [],
                        })
                      }
                      void runRemove()
                    }}
                  >
                    {labels.remove}
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

function StylePieceCard({
  look,
  index,
  owner,
  compositionKey,
  resetNonce,
  headingRef,
  anchorPhoto,
  labels,
  samples,
  canSave,
  onSave,
  onUndoSave,
  onViewSaved,
  onSwap,
}: {
  look: StylePieceLook
  index: number
  owner: string
  compositionKey: string
  resetNonce: number
  headingRef?: RefObject<HTMLHeadingElement | null>
  anchorPhoto: React.ReactNode
  labels: Labels
  samples: SampleLabels
  canSave: boolean
  onSave: () => Promise<boolean>
  onUndoSave: () => Promise<boolean>
  onViewSaved: () => void
  onSwap: (category: SampleGarmentCategory, id: string) => void
}) {
  const [editing, setEditing] = useState<SampleGarmentCategory | null>(null)
  const swapInvoker = useRef<HTMLButtonElement | null>(null)
  const recipeKey = stylePieceRecipeKey(look.recipe)

  return (
    <article
      data-testid="style-piece-look"
      data-style-look={stylePieceRecipeKey(look.recipe)}
      className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
    >
      <h3
        ref={headingRef}
        tabIndex={-1}
        data-testid="style-piece-look-title"
        className="font-semibold"
      >
        {formatPreviewString(labels.idea, { number: index + 1 })}
      </h3>
      <div className="flex flex-wrap items-start gap-3">
        {anchorPhoto}
        <div className="min-w-0 flex-1 basis-44 space-y-2">
          <h4 className="text-sm font-semibold">{labels.companions}</h4>
          <ul className="space-y-2">
            {look.companions.map((item) => {
              const options = stylePieceSwapOptions(look, item.category).filter(
                ({ id }) => id !== item.id
              )
              const expanded = editing === item.category
              const swapLabel = formatPreviewString(samples.outfit.swapTitle, {
                category: samples.values.category[item.category],
              })
              return (
                <li key={item.category}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-md bg-[#F5F5F7]">
                      <SampleGarmentArt garment={item} className="h-11 w-11" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm">{sampleGarmentText(item, samples).name}</p>
                      {options.length > 0 && (
                        <button
                          type="button"
                          data-testid={`style-piece-swap-${item.category}`}
                          aria-expanded={expanded}
                          className={action}
                          onClick={(event) => {
                            swapInvoker.current = event.currentTarget
                            setEditing(expanded ? null : item.category)
                          }}
                        >
                          {swapLabel}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <ul aria-label={swapLabel} className="mt-1 space-y-1 pl-2">
                      {options.map((option) => (
                        <li key={option.id}>
                          <button
                            type="button"
                            data-testid={`style-piece-option-${option.id}`}
                            className={`${button} flex w-full items-center gap-2 text-left`}
                            onClick={() => {
                              onSwap(item.category, option.id)
                              setEditing(null)
                              requestAnimationFrame(() => swapInvoker.current?.focus())
                            }}
                          >
                            <span className="shrink-0 rounded-md bg-[#F5F5F7]">
                              <SampleGarmentArt garment={option} className="h-9 w-9" />
                            </span>
                            {sampleGarmentText(option, samples).name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <SaveActionButton
        idleLabel={labels.save}
        disabled={!canSave}
        requiresNetwork
        data-testid="style-piece-save"
        ownerKey={owner}
        resetKey={`${recipeKey}:${compositionKey}:${resetNonce}`}
        onSave={onSave}
        onUndo={onUndoSave}
        onView={onViewSaved}
        barPlacement="inline"
      />
    </article>
  )
}
