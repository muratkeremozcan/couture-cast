'use client'

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { withRequestDeadline } from '@couture/api-client'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  buildStylePieceSavedLookInput,
  createAnnouncementToken,
  createIdempotencyKey,
  createStylePieceRefresh,
  formatPreviewString,
  formatSampleTemperature,
  getGuestPreviewStrings,
  getStylePieceStrings,
  initialStylePieceWeather,
  isOfflineError,
  isStylePieceTagged,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  SAMPLE_CATALOG,
  sampleGarmentText,
  SAMPLE_WEATHER,
  savedLookToStylePieceRecipe,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceLooks,
  stylePieceRecipeKey,
  stylePieceSwapOptions,
  visibleStylePieceLooks,
  type SampleGarmentCategory,
  type StylePieceWeatherKey,
  type StylePieceLook,
  type StylePieceAnchor,
  type StylePiecePhotoAnchor,
  type StylePieceSelection,
  type StylePieceRecipe,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  listSavedLooksFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
} from '../../lib/saved-looks'
import { onWebSessionIdentity } from '../../lib/web-session'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
} from '../../lib/use-web-session'
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

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

export function StylePiecePanel({
  selection,
  initialSavedLook,
  inWardrobe,
  loadInventory,
  owner,
  locale,
  invoker,
  onSavedLooksChanged,
  onClose,
}: {
  selection: StylePieceSelection
  initialSavedLook?: SavedLookContract | null
  inWardrobe: boolean
  loadInventory: (signal: AbortSignal) => Promise<GarmentItemContract[] | null>
  owner: string
  locale: string
  invoker: RefObject<HTMLElement | null>
  onSavedLooksChanged?: () => void
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
            key={JSON.stringify([
              selection.id,
              piece.category,
              piece.comfortRange,
              initialSavedLook?.id ?? null,
            ])}
            anchor={inWardrobe ? anchor : null}
            piece={piece}
            initialSavedLook={initialSavedLook}
            refreshRef={refreshRef}
            owner={owner}
            garmentId={selection.id}
            locale={locale}
            labels={labels}
            samples={samples}
            onSavedLooksChanged={onSavedLooksChanged}
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
  initialSavedLook,
  refreshRef,
  owner,
  garmentId,
  locale,
  labels,
  samples,
  onSavedLooksChanged,
}: {
  anchor: StylePiecePhotoAnchor | null | undefined
  piece: StylePieceAnchor
  initialSavedLook?: SavedLookContract | null
  refreshRef: RefObject<InventoryRefresh | null>
  owner: string
  garmentId: string
  locale: string
  labels: Labels
  samples: SampleLabels
  onSavedLooksChanged?: () => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const statusBar = useStatusBar()
  const { category, comfortRange } = piece
  const photo = anchor?.photo
  const initialRecipe = initialSavedLook
    ? savedLookToStylePieceRecipe(initialSavedLook)
    : null
  const [weather, setWeather] = useState<StylePieceWeatherKey>(
    () => initialRecipe?.weather ?? initialStylePieceWeather(piece)
  )
  const [edits, setEdits] = useState<Record<string, StylePieceRecipe>>(() =>
    initialRecipe ? { [initialRecipe.lookId]: initialRecipe } : {}
  )
  const [reopened, setReopened] = useState<string | undefined>(
    () => initialRecipe?.lookId
  )
  const [latestEdit, setLatestEdit] = useState<string | undefined>(
    () => initialRecipe?.lookId
  )
  const [saved, setSaved] = useState<SavedLookContract[]>([])
  const [savedResetNonce, setSavedResetNonce] = useState(0)
  const [savedState, setSavedState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading'
  )
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string>()
  const photoFailed = failedPhotoUrl !== undefined && failedPhotoUrl === photo?.url
  const [retrying, setRetrying] = useState(false)
  const authorized = Boolean(anchor) && !photoFailed
  const weatherRef = useRef<HTMLButtonElement | null>(null)
  const currentLookHeading = useRef<HTMLHeadingElement | null>(null)
  const savedSectionRef = useRef<HTMLElement | null>(null)
  const swapUndoStackRef = useRef<Record<string, StylePieceRecipe>[]>([])
  const swapRevisionRef = useRef(0)
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<Record<string, SavedLookContract>>({})
  const deletedIdsRef = useRef<Set<string>>(new Set())
  const mutationVersionRef = useRef(0)
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
    const loadVersion = mutationVersionRef.current
    const controller = new AbortController()
    setSavedState('loading')
    void listSavedLooksFromWeb({
      source: 'style_piece',
      anchorGarmentId: garmentId,
      signal: controller.signal,
    })
      .then((items) => {
        if (
          controller.signal.aborted ||
          !refreshRef.current?.currentAnchor() ||
          currentWebSessionOwner() !== owner
        )
          return
        setSaved((current) => {
          if (mutationVersionRef.current === loadVersion) return items
          const seen = new Set(current.map((item) => item.id))
          return [
            ...current,
            ...items.filter(
              (item) => !seen.has(item.id) && !deletedIdsRef.current.has(item.id)
            ),
          ]
        })
        setSavedState('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setSavedState('unavailable')
      })
    return () => controller.abort()
  }, [authorized, garmentId, owner, refreshRef])

  const currentPiece = (inventory: InventoryRefresh | null) => {
    const fresh = inventory?.currentAnchor()
    return fresh?.category === category && fresh.comfortRange === comfortRange
      ? fresh
      : null
  }

  const verifyAnchorForAction = async () => {
    const inventory = refreshRef.current
    const refreshResult = await inventory?.refreshForAction()
    if (!refreshResult || refreshResult.status === 'revoked') return null
    if (refreshResult.status === 'error') throw refreshResult.error
    return currentPiece(inventory)
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

  const openSaved = async (entry: SavedLookContract) => {
    const revision = ++draftRevision.current
    const inventory = refreshRef.current
    if (!(await inventory?.refresh()) || draftRevision.current !== revision) return
    const fresh = currentPiece(inventory)
    if (!fresh) return
    const recipe = savedLookToStylePieceRecipe(entry)
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
            canSave={savedState !== 'loading'}
            onSave={async () => {
              const startSwapRevision = swapRevisionRef.current
              const fresh = await verifyAnchorForAction()
              if (!fresh) return false
              const payload = buildStylePieceSavedLookInput(
                {
                  id: garmentId,
                  category: fresh.category,
                  comfortRange: fresh.comfortRange,
                },
                look
              )
              const existingMatch = saved.find((item) => {
                if (
                  item.source !== 'style_piece' ||
                  item.lookId !== payload.lookId ||
                  item.weather !== payload.weather ||
                  item.anchorGarmentId !== garmentId ||
                  item.composition.length !== payload.composition.length
                ) {
                  return false
                }
                return payload.composition.every((slot) => {
                  const match = item.composition[slot.slotIndex]
                  return (
                    match !== undefined &&
                    match.kind === slot.kind &&
                    match.category === slot.category &&
                    match.itemId === slot.itemId
                  )
                })
              })
              const attemptKey = `${recipeKey}:${compositionKey}`
              if (existingMatch) {
                delete lastCreatedRef.current[attemptKey]
                setSavedState('ready')
                if (swapRevisionRef.current === startSwapRevision) {
                  swapUndoStackRef.current = []
                }
                return { saved: true, undoable: false }
              }
              const actionToken = currentWebSessionBearer() ?? undefined
              let idempotencyKey = saveAttemptKeysRef.current.get(attemptKey)
              if (!idempotencyKey) {
                idempotencyKey = createIdempotencyKey()
                saveAttemptKeysRef.current.set(attemptKey, idempotencyKey)
              }
              let created: SavedLookContract
              try {
                created = await createSavedLookFromWeb(payload, {
                  accessToken: actionToken,
                  idempotencyKey,
                })
              } catch (error) {
                if (error instanceof SavedLookRequestError && error.status === 409) {
                  saveAttemptKeysRef.current.delete(attemptKey)
                  if (error.code === 'SAVED_LOOK_ALREADY_REMOVED') {
                    return false
                  }
                }
                throw error
              }
              if (currentWebSessionOwner() !== owner) return false
              saveAttemptKeysRef.current.delete(attemptKey)
              deletedIdsRef.current.delete(created.id)
              mutationVersionRef.current += 1
              lastCreatedRef.current[attemptKey] = created
              setSaved((current) => [
                created,
                ...current.filter((item) => item.id !== created.id),
              ])
              setSavedState('ready')
              onSavedLooksChanged?.()
              notifySavedLooksChanged(owner)
              if (swapRevisionRef.current === startSwapRevision) {
                swapUndoStackRef.current = []
              }
              return true
            }}
            onUndoSave={async () => {
              const attemptKey = `${recipeKey}:${compositionKey}`
              const created = lastCreatedRef.current[attemptKey]
              if (!created) return false
              const fresh = await verifyAnchorForAction()
              if (!fresh) return false
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
              if (currentWebSessionOwner() !== owner) return false
              deletedIdsRef.current.add(created.id)
              mutationVersionRef.current += 1
              delete lastCreatedRef.current[attemptKey]
              setSaved((current) => current.filter((item) => item.id !== created.id))
              onSavedLooksChanged?.()
              notifySavedLooksChanged(owner)
              return true
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

      {savedState === 'unavailable' && (
        <p role="alert" className="text-sm">
          {t('savedLooks.loadFailed')}
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
            const companionNames = entry.composition
              .filter((slot) => slot.kind === 'catalog')
              .map((slot) => {
                const item = CATALOG_BY_ID.get(slot.itemId)
                return item
                  ? sampleGarmentText(item, samples).name
                  : (slot.label ?? samples.values.category[slot.category])
              })
            const description = [
              samples.values.weather[entry.weather as StylePieceWeatherKey] ??
                entry.weather,
              ...companionNames,
            ].join(' · ')
            return (
              <div
                key={entry.id}
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
                        let alreadyDeleted = false
                        try {
                          const fresh = await verifyAnchorForAction()
                          if (!fresh) return
                          const actionToken = currentWebSessionBearer() ?? undefined
                          try {
                            await deleteSavedLookFromWeb(
                              entry.id,
                              formatSavedLookIfMatch(entry.id, entry.revision),
                              { accessToken: actionToken }
                            )
                          } catch (deleteError) {
                            if (
                              deleteError instanceof SavedLookRequestError &&
                              deleteError.status === 404
                            ) {
                              alreadyDeleted = true
                            } else {
                              throw deleteError
                            }
                          }
                          if (currentWebSessionOwner() !== owner) return
                          deletedIdsRef.current.add(entry.id)
                          mutationVersionRef.current += 1
                          setSaved((current) =>
                            current.filter((item) => item.id !== entry.id)
                          )
                          onSavedLooksChanged?.()
                          notifySavedLooksChanged(owner)
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
                        setSavedResetNonce((value) => value + 1)
                        weatherRef.current?.focus()
                        const seq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `style-piece-remove-${seq}`,
                          announcementId: createAnnouncementToken(
                            'style-piece-remove',
                            seq
                          ),
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
                                    try {
                                      const fresh = await verifyAnchorForAction()
                                      if (!fresh) return
                                      const restored = await restoreSavedLookFromWeb(
                                        entry.id,
                                        {
                                          accessToken:
                                            currentWebSessionBearer() ?? undefined,
                                        }
                                      )
                                      if (currentWebSessionOwner() !== owner) return
                                      deletedIdsRef.current.delete(restored.id)
                                      mutationVersionRef.current += 1
                                      setSaved((current) => [
                                        restored,
                                        ...current.filter(
                                          (item) => item.id !== restored.id
                                        ),
                                      ])
                                      onSavedLooksChanged?.()
                                      notifySavedLooksChanged(owner)
                                      const undoSeq = ++noticeSeqRef.current
                                      statusBarRef.current.showNotice({
                                        id: `style-piece-remove-undo-${undoSeq}`,
                                        announcementId: createAnnouncementToken(
                                          'style-piece-remove-undo',
                                          undoSeq
                                        ),
                                        message: t('feedback.undone'),
                                        tone: 'neutral',
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
                                    }
                                  },
                                },
                              ],
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
  onSave: () => Promise<boolean | { saved: boolean; undoable?: boolean }>
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
