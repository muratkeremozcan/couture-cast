// Story CC-7.12 D5 owner: a saved look's own screen (`/looks/saved/[savedLookId]`). It reads the
// one look, shows its pieces with the missing and needs-review notices, and Remove with Undo.
// View on every save confirmation and every Saved tile open it, so a deep link, back and a
// reload behave the same. A look that is gone or not this member's reads like a removed one.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type {
  GarmentWithColor,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createAnnouncementToken,
  formatTodayWornOn,
  getGuestPreviewStrings,
  getTodayOutfitStrings,
  isOfflineError,
  parseLooksFilter,
  SAMPLE_CATALOG,
  sampleGarmentText,
  type LooksFilter,
  type SampleWeatherKey,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { hasAppHistoryBelow } from '../../../lib/app-history'
import { listGarmentsFromWeb } from '../../../lib/wardrobe'
import {
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  getSavedLookFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
} from '../../../lib/saved-looks'
import {
  currentWebSessionBearer,
  currentWebSessionOwner,
  useWebSessionOwner,
} from '../../../lib/use-web-session'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../app-page'
import { AppTopBar } from '../app-top-bar'
import { SampleGarmentArt } from '../guest-preview/sample-garment-art'
import { useStatusBar } from '../save-feedback'
import { StickyBottomNav } from '../sticky-bottom-nav'
import { savedLooksHref } from './looks-address'
import { StylePiecePanel } from '../../wardrobe/style-piece-panel'
import { useSavedLookName } from './looks-tile'
import { trackOwnedNotice } from './owned-notices'
import { reopenAnchorFor } from './saved-look-reopen'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; look: SavedLookContract }
  | { kind: 'gone' }
  | { kind: 'error' }

/**
 * The Saved filter a tile opened this look from, or null for any other entry (View, a link).
 * Fable review P1: read through `useSearchParams`, since a client navigation renders the new page
 * before `window.location` holds its URL.
 */
function useFrom(): LooksFilter | null {
  const params = useSearchParams()
  return params?.has('from') ? parseLooksFilter(params.get('from')) : null
}

function SlotRow({
  look,
  slot,
}: {
  look: SavedLookContract
  slot: SavedLookContract['composition'][number]
}) {
  const { t, i18n } = useTranslation('translation', {
    i18n: getI18n(),
    useSuspense: false,
  })
  const samples = getGuestPreviewStrings(i18n.language)
  // Codex #7: a failure belongs to one signed URL, so a refreshed URL gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const category = samples.values.category[slot.category]
  const box =
    'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md'
  let visual
  let label = category
  if (slot.kind === 'catalog') {
    const item = CATALOG_BY_ID.get(slot.itemId)
    label = item ? sampleGarmentText(item, samples).name : (slot.label ?? category)
    visual = (
      <span className={`${box} bg-card-muted p-1`}>
        {item ? <SampleGarmentArt garment={item} className="h-full w-full" /> : null}
      </span>
    )
  } else if (slot.missing) {
    label = `${category} · ${t('savedLooks.missingPiece')}`
    visual = (
      <span
        aria-hidden="true"
        className={`${box} border border-dashed border-notice-line bg-notice-surface text-notice-ink`}
      >
        ?
      </span>
    )
  } else if (
    slot.imageAccess?.url &&
    slot.imageAccess.url !== failedUrl &&
    Date.parse(slot.imageAccess.expiresAt) > Date.now()
  ) {
    const url = slot.imageAccess.url
    visual = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="h-12 w-12 shrink-0 rounded-md object-cover"
        onError={() => setFailedUrl(url)}
      />
    )
  } else {
    label = `${category} · ${t('savedLooks.photoUnavailable')}`
    visual = (
      <span
        data-testid="saved-look-photo-placeholder"
        className={`${box} bg-card-muted text-xs font-semibold text-ink-soft`}
      >
        {category.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <li
      data-testid={`saved-look-slot-${slot.slotIndex}`}
      data-slot-item-id={slot.itemId}
      data-look-id={look.id}
      className="flex min-h-touch items-center gap-3 border-b border-line py-2 text-sm text-ink last:border-b-0"
    >
      {visual}
      <span className="min-w-0">{label}</span>
    </li>
  )
}

function SavedLookSummary({ look }: { look: SavedLookContract }) {
  const { t, i18n } = useTranslation('translation', {
    i18n: getI18n(),
    useSuspense: false,
  })
  const samples = getGuestPreviewStrings(i18n.language)
  const weather = look.wornOn
    ? t(`home.today.conditions.${look.weather}`)
    : (samples.values.weather[look.weather as SampleWeatherKey] ?? look.weather)
  const source = look.wornOn
    ? getTodayOutfitStrings(i18n.language).source
    : t(
        look.source === 'style_piece'
          ? 'savedLooks.sourceStylePiece'
          : 'savedLooks.sourceHomeSample'
      )
  return (
    <p className="text-sm text-ink-soft">
      {weather} · {source}
      {look.wornOn && ` · ${formatTodayWornOn(look.wornOn, i18n.language)}`}
    </p>
  )
}

function DetailBody({
  owner,
  savedLookId,
  state,
  from,
  onLookChanged,
}: {
  owner: string | null
  savedLookId: string
  state: DetailState
  from: LooksFilter | null
  onLookChanged: () => void
}) {
  const { t, i18n } = useTranslation('translation', {
    i18n: getI18n(),
    useSuspense: false,
  })
  const router = useRouter()
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const [removing, setRemoving] = useState(false)
  const seqRef = useRef(0)
  // TEA T3 (CC-7.2 AC1): a Style this piece look reopens in the editor on its anchor garment, so
  // the closet is read for those looks only.
  const styleLook = state.kind === 'ready' && state.look.source === 'style_piece'
  const [garments, setGarments] = useState<GarmentWithColor[]>([])
  const [reopening, setReopening] = useState(false)
  const reopenInvoker = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!owner || !styleLook) return
    const controller = new AbortController()
    listGarmentsFromWeb(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted && currentWebSessionOwner() === owner)
          setGarments(items)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [owner, styleLook])

  if (!owner) {
    return (
      <div data-testid="saved-look-detail-signed-out" className="space-y-3">
        <p className="text-base text-ink">{t('looks.detail.signIn')}</p>
        <Link
          href="/signin"
          className="inline-flex min-h-touch items-center font-semibold text-ink underline"
        >
          {t('looks.detail.signInAction')}
        </Link>
      </div>
    )
  }
  if (state.kind === 'loading') {
    return (
      <p className="text-sm text-ink-muted" aria-busy="true">
        …
      </p>
    )
  }
  if (state.kind === 'gone') {
    return (
      <p data-testid="saved-look-detail-gone" className="text-base text-ink">
        {t('looks.detail.gone')}
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p
        role="alert"
        data-testid="saved-look-detail-error"
        className="text-sm text-danger-ink"
      >
        {t('savedLooks.loadFailed')}
      </p>
    )
  }

  const look = state.look
  const online = () =>
    statusBarRef.current.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  // The notices outlive this screen (the bar lives in the root layout), so an action checks the
  // signed-in member, never this screen's mount.
  const stillOwner = () => currentWebSessionOwner() === owner
  const notice = (
    kind: string,
    message: string,
    tone: 'neutral' | 'error' | 'offline',
    actions: Parameters<typeof statusBar.showNotice>[0]['actions'] = []
  ) => {
    if (!stillOwner()) return
    const seq = ++seqRef.current
    const id = `looks-saved-look-${kind}-${seq}`
    const bar = statusBarRef.current
    // Codex TEA review #3: the notice leaves the bar once another member holds the session.
    trackOwnedNotice(id, owner, () => bar.dismissNotice(id))
    bar.showNotice({
      id,
      announcementId: createAnnouncementToken(`looks-saved-look-${kind}`, seq),
      message,
      tone,
      actions,
    })
  }
  const failure = (kind: string, error: unknown, retry?: () => void) => {
    const offline = isOfflineError(error) || !online()
    notice(
      `${kind}-${offline ? 'offline' : 'failed'}`,
      offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
      offline ? 'offline' : 'error',
      retry && !offline
        ? [{ id: 'retry', kind: 'retry', label: t('feedback.retry'), onPress: retry }]
        : []
    )
  }

  // Codex #8: Undo keeps a recovery action offline too (Undo once back online, Retry after a
  // failed restore), and one restore runs at a time.
  let undoInFlight = false
  const undoFailed = (error: unknown, token: string | undefined) => {
    const offline = isOfflineError(error) || !online()
    notice(
      `undo-${offline ? 'offline' : 'failed'}`,
      offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
      offline ? 'offline' : 'error',
      [
        {
          id: offline ? 'undo' : 'retry',
          kind: offline ? 'undo' : 'retry',
          label: offline ? t('feedback.undo') : t('feedback.retry'),
          onPress: () => void runUndo(token),
        },
      ]
    )
  }
  const runUndo = async (token: string | undefined) => {
    if (undoInFlight || !stillOwner()) return
    if (!online()) {
      undoFailed(new TypeError('Failed to fetch'), token)
      return
    }
    undoInFlight = true
    try {
      await restoreSavedLookFromWeb(look.id, { accessToken: token })
      if (!stillOwner()) return
      notifySavedLooksChanged(owner)
      notice('undo', t('feedback.undone'), 'neutral')
    } catch (error) {
      if (!stillOwner()) return
      undoFailed(error, token)
    } finally {
      undoInFlight = false
    }
  }

  const remove = async () => {
    const token = currentWebSessionBearer() ?? undefined
    if (!online()) {
      failure('remove', new TypeError('Failed to fetch'))
      return
    }
    setRemoving(true)
    let alreadyGone = false
    try {
      await deleteSavedLookFromWeb(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision),
        {
          accessToken: token,
        }
      )
    } catch (error) {
      if (error instanceof SavedLookRequestError && error.status === 404) {
        alreadyGone = true
      } else {
        setRemoving(false)
        failure('remove', error, () => void remove())
        return
      }
    }
    if (!stillOwner()) return
    notifySavedLooksChanged(owner)
    notice(
      'remove',
      t('feedback.removed'),
      'neutral',
      alreadyGone
        ? []
        : [
            {
              id: 'undo',
              kind: 'undo',
              label: t('feedback.undo'),
              onPress: () => runUndo(token),
            },
          ]
    )
    // P10: Remove returns to Saved with the filter the look was opened from. Opened from a Saved
    // tile, the entry below is that Saved page, so back returns to it without a second entry;
    // any other entry replaces this one with Saved.
    if (from !== null && hasAppHistoryBelow()) router.back()
    else router.replace(savedLooksHref(from ?? 'all'))
  }

  const anchor = reopenAnchorFor(look, garments)
  return (
    <div
      data-testid="saved-look-detail"
      data-saved-look-id={savedLookId}
      className="space-y-4"
    >
      <SavedLookSummary look={look} />
      {look.availabilityStatus === 'missing_garment' && (
        <p
          role="status"
          data-testid="saved-look-detail-missing"
          className="rounded-lg border border-notice-line bg-notice-surface p-3 text-sm text-notice-ink"
        >
          {t('savedLooks.missingPieceDetail')}
        </p>
      )}
      {look.availabilityStatus === 'needs_review' && (
        <p
          role="status"
          data-testid="saved-look-detail-needs-review"
          className="rounded-lg border border-line bg-card-muted p-3 text-sm text-ink"
        >
          {t('savedLooks.needsReviewDetail')}
        </p>
      )}
      <section aria-labelledby="saved-look-pieces">
        <h2 id="saved-look-pieces" className="text-sm font-semibold text-ink">
          {t('savedLooks.slotOrderLabel')}
        </h2>
        <ol className="mt-2">
          {[...look.composition]
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((slot) => (
              <SlotRow key={`${slot.slotIndex}-${slot.itemId}`} look={look} slot={slot} />
            ))}
        </ol>
      </section>
      {anchor && (
        <button
          type="button"
          data-testid="saved-look-reopen"
          onClick={(event) => {
            reopenInvoker.current = event.currentTarget
            setReopening(true)
          }}
          className="mr-2 min-h-touch rounded-lg border border-line-strong bg-page px-3 text-sm font-semibold text-ink"
        >
          {t('savedLooks.reopen')}
        </button>
      )}
      <button
        type="button"
        data-testid="saved-look-detail-remove"
        disabled={removing}
        onClick={() => void remove()}
        className="min-h-touch rounded-lg border border-line-strong bg-page px-3 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {t('savedLooks.remove')}
      </button>
      {anchor && reopening && anchor.category && anchor.comfortRange && (
        <StylePiecePanel
          selection={{
            id: anchor.id,
            category: anchor.category,
            comfortRange: anchor.comfortRange,
          }}
          initialSavedLook={look}
          inWardrobe
          loadInventory={(signal) => listGarmentsFromWeb(signal)}
          owner={owner}
          locale={i18n.language}
          invoker={reopenInvoker}
          onSavedLooksChanged={onLookChanged}
          onClose={() => setReopening(false)}
        />
      )}
    </div>
  )
}

function useSavedLook(
  owner: string | null,
  savedLookId: string
): { state: DetailState; reload: () => void } {
  const [state, setState] = useState<DetailState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    // P6: signed out sends no read.
    if (!owner) return
    const controller = new AbortController()
    // A reload after an edit keeps the look on screen (and an open editor) until it answers.
    setState((previous) => (previous.kind === 'ready' ? previous : { kind: 'loading' }))
    getSavedLookFromWeb(savedLookId, {
      accessToken: currentWebSessionBearer() ?? undefined,
      signal: controller.signal,
    })
      .then((look) => {
        if (controller.signal.aborted || currentWebSessionOwner() !== owner) return
        // The API answers only the signed-in member's looks; another member's id is a 404 and
        // reads like a removed one (P6).
        setState({ kind: 'ready', look })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const status = error instanceof SavedLookRequestError ? error.status : undefined
        setState(
          status === 404 || status === 403 || status === 400
            ? { kind: 'gone' }
            : { kind: 'error' }
        )
      })
    return () => controller.abort()
  }, [owner, savedLookId, attempt])
  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { state, reload }
}

function SavedLookDetail({ savedLookId }: { savedLookId: string }) {
  const { t } = useTranslation('translation', { i18n: getI18n(), useSuspense: false })
  const owner = useWebSessionOwner()
  const router = useRouter()
  const { state, reload } = useSavedLook(owner, savedLookId)
  const name = useSavedLookName()
  const from = useFrom()
  const title =
    owner && state.kind === 'ready' ? name(state.look) : t('looks.segments.saved')
  return (
    <AppPage>
      {from === null ? (
        // TEA T4: a look opened by View (or a link) returns to Saved, not to the saving screen.
        <AppTopBar title={title} onBack={() => router.replace(savedLooksHref('all'))} />
      ) : (
        <AppTopBar title={title} parentHref={savedLooksHref(from)} />
      )}
      <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
        <DetailBody
          key={owner ?? 'signed-out'}
          owner={owner}
          savedLookId={savedLookId}
          state={state}
          from={from}
          onLookChanged={reload}
        />
      </main>
      <StickyBottomNav />
    </AppPage>
  )
}

export function SavedLookDetailScreen({ savedLookId }: { savedLookId: string }) {
  // Codex #3: the detail's state is keyed by the signed-in member, so an account switch never
  // shows the previous member's look while the new read is in flight.
  const owner = useWebSessionOwner()
  return (
    <I18nextProvider i18n={getI18n()}>
      <Suspense fallback={null}>
        <SavedLookDetail key={owner ?? 'signed-out'} savedLookId={savedLookId} />
      </Suspense>
    </I18nextProvider>
  )
}
