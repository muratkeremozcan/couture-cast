// Story 6.8 Task 5 step 1 owner: compose, preview and save on mobile in `apps/mobile/components/share-card-composer.tsx`
import { shareCardPreviewTestId } from '@/src/lib/share-card-native-fixture'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  modalSystemBarsAvailable,
  setModalDarkStatusBar,
} from '../modules/modal-system-bars'
import { useShareCardStatusBar } from '@/src/lib/use-share-card-status-bar'
import {
  AccessibilityInfo,
  AppState,
  Image,
  type LayoutChangeEvent,
  Linking,
  PixelRatio,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  ResponseError,
  type PreparedShareCard,
  type ShareCardSource,
} from '@couture/api-client'
import { resolveSupportedLocale } from '@couture/api-client/contracts/http'
import { EdgeToEdgeModal, useModalInsets } from './edge-to-edge-modal'
import { isRectInViewport, revealOffset } from './community/compose-field-reveal'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { focusShareCardElement } from '@/src/lib/share-card-focus'
import { traceShareCardOpener } from '@/src/lib/share-card-presentation-trace'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  prepareShareCardFromMobile,
  shareCardCapabilitiesFromMobile,
} from '@/src/lib/share-cards'
import {
  nativeShareCardSaveAvailable,
  saveShareCard,
  shareCardSavePermission,
} from '@/src/lib/share-card-save'
import {
  nativeShareCardSavePending,
  ownsPendingShareCardSave,
  subscribeShareCardSave,
} from '@/src/lib/share-card-save-operations'
import {
  nativeShareCardShareAvailable,
  shareShareCard,
  type ShareCardShareSettlement,
} from '@/src/lib/share-card-share'
import type { ShareCardShareAnchor } from '../modules/share-card-native-share/types'
import { trackMobileShareCardShared } from '@/src/analytics/track-events'

type PreparedPreview = {
  card: PreparedShareCard
  key: string
  member: string | null
  sourceIdentity: string
  renderId: number
}
const saveDisabled = (
  valid: boolean,
  loaded: boolean,
  busy: boolean,
  pending: boolean,
  available: boolean
) => !valid || !loaded || busy || pending || !available
function saveFailure(error: unknown) {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : error.message
    if (code === 'offline') return 'offline'
    if (['render', 'invalid_file'].includes(code)) return 'render'
    if (['permission_denied', 'ERR_PERMISSIONS'].includes(code)) return 'permissionDenied'
    if (code === 'finishingSave') return 'finishingSave'
  }
  if (error instanceof ResponseError) {
    if (error.response.status === 409) return 'previewChanged'
    if ([401, 403, 404].includes(error.response.status)) return 'sourceUnavailable'
    if (error.response.status === 503) return 'render'
  }
  return 'storage'
}

/** Story 6.9: each settled outcome's copy, and whether it is a merlot error. */
const shareFeedback: Record<
  ShareCardShareSettlement['outcome'],
  { key: string; error: boolean }
> = {
  completed: { key: 'shared', error: false },
  target_chosen: { key: 'sentToApp', error: false },
  handed_off: { key: 'sentToApp', error: false },
  cancelled: { key: 'shareClosed', error: false },
  dismissed: { key: 'shareClosed', error: false },
  not_confirmed: { key: 'shareClosed', error: false },
  failed: { key: 'shareFailed', error: true },
  unavailable: { key: 'shareUnavailable', error: true },
}
/** iOS completed into an app outside the allowlist (Copy, Print, Files) claims only the handoff. */
const shareFeedbackFor = ({ outcome, target }: ShareCardShareSettlement) =>
  outcome === 'completed' && target === 'other'
    ? shareFeedback.handed_off
    : shareFeedback[outcome]
/** Every share outcome except failed and unavailable returns focus to Share. */
const focusShareAfter = new Set(['shared', 'sentToApp', 'shareClosed'])
const focusSaveAfter = new Set(['saved', 'shareFailed', 'shareUnavailable'])
/** Share failures recover through Save or Share, so no Retry action replaces the preview. */
const shareErrors = new Set(['shareFailed', 'shareUnavailable'])
const sharePreviewChanged = (failure: unknown) =>
  (failure instanceof ResponseError && failure.response.status === 409) ||
  (failure instanceof Error && failure.message === 'previewChanged')
const errorNamed = (failure: unknown, name: string) =>
  failure instanceof Error && (failure.name === name || failure.message === name)
/** The share prepare's flag-off refusal: a 403 whose body names `share_disabled`. */
async function shareDisabledRefusal(failure: unknown) {
  if (!(failure instanceof ResponseError) || failure.response.status !== 403) return false
  const body: unknown = await failure.response
    .clone()
    .json()
    .catch(() => null)
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === 'share_disabled'
  )
}
const ANCHOR_TIMEOUT_MS = 1000
/** The app's 420-pt tablet convention (modals, spotlight cards): content stays phone-sized. */
const CONTENT_MAX_WIDTH = 420
const CONTENT_INSET = 24
const CONTENT_GAP = 16
const ACTION_GAP = 12
const PREVIEW_ASPECT = 1080 / 1350
/** Share of a wide window's height the preview may take, so every action stays on screen. */
const WIDE_PREVIEW_HEIGHT_SHARE = 0.45
/** One feedback line: the reserved slot and the status and error copy share it. */
const FEEDBACK_LINE_HEIGHT = 22
/**
 * The narrowest text column, in points at font scale 1, that fits every status and error string
 * of all ten mobile catalogs on two lines. Measured at 16 pt with SF Pro (iOS) and Roboto
 * (Android 16): the widest need is 289 pt, for de-DE `storage`. Every phone from 360 pt up gets
 * a column of 312 pt or more; only a 320-pt window (Display Zoom on a 375-pt iPhone, or Android at
 * a large display size) falls below, where de-DE and pt `storage` copy takes three lines.
 */
const FEEDBACK_TWO_LINE_COLUMN = 292
/**
 * The height the feedback slot reserves: the most lines any status or error string takes in this
 * window's column at the current font scale, so copy appearing or changing never moves Save and
 * Share (the iPad popover anchors on Share). Larger text keeps the reservation scaled; copy that
 * still needs more lines grows the slot and is never truncated. Each line is rounded up to whole
 * pixels as Android lays out every text line, so a 22-pt line at 2.625x reserves 58 px, not 57.75.
 */
export function feedbackSlotHeight(
  windowWidth: number,
  fontScale: number,
  pixelRatio: number
) {
  const column = Math.min(windowWidth - 2 * CONTENT_INSET, CONTENT_MAX_WIDTH)
  const lines = column / fontScale >= FEEDBACK_TWO_LINE_COLUMN ? 2 : 3
  return (lines * Math.ceil(FEEDBACK_LINE_HEIGHT * fontScale * pixelRatio)) / pixelRatio
}
/**
 * A window wider than the capped content (a tablet) centers the column and caps the preview's
 * height. Phones are at most 440 pt wide, so their content never reaches the cap and keeps the
 * full-width preview.
 */
function useWidePreviewWidth() {
  const { width, height } = useWindowDimensions()
  if (width - 2 * CONTENT_INSET <= CONTENT_MAX_WIDTH) return null
  return Math.min(
    CONTENT_MAX_WIDTH,
    Math.floor(height * WIDE_PREVIEW_HEIGHT_SHARE * PREVIEW_ASPECT)
  )
}
/**
 * The narrowest preview the fit may leave: the card's 36-px body text still renders at 8 pt. A
 * composer that does not fit even then (large text sizes) keeps this width and scrolls.
 */
const PREVIEW_MIN_WIDTH = 240
/**
 * The preview width that keeps every action on screen at rest: the height the viewport has left
 * after the rest of the composer, at the card's aspect ratio, within the column (or a wide
 * window's cap) and the legible floor. Null keeps the full-width preview. On a 375-by-667 iPhone
 * the full-width card alone takes 409 of the 615 pt the composer can show, so it gives way; an
 * iPhone 17 Pro or a 411-dp Android phone keeps the full width.
 */
export function fittedPreviewWidth(
  column: number,
  viewport: number,
  chrome: number,
  cap: number | null
): number | null {
  const fit = Math.floor((viewport - chrome) * PREVIEW_ASPECT)
  const limit = cap ?? column
  if (fit >= limit) return cap
  return Math.min(limit, Math.max(PREVIEW_MIN_WIDTH, fit))
}
type FitFrames = { viewport: number; above: number; below: number }
/**
 * Measures the scroll viewport and the blocks above and below the preview. Neither block depends
 * on the preview's size, so a measurement never feeds back into itself. Copy that grows a block
 * (a wrapped recovery row, feedback past its reserved lines) takes its height from the preview.
 */
function usePreviewFit() {
  const { width } = useWindowDimensions()
  const cap = useWidePreviewWidth()
  const [frames, setFrames] = useState<FitFrames>({ viewport: 0, above: 0, below: 0 })
  const measure =
    (key: keyof FitFrames) =>
    ({ nativeEvent }: LayoutChangeEvent) => {
      const { height } = nativeEvent.layout
      setFrames((current) =>
        Math.abs(current[key] - height) < 0.5 ? current : { ...current, [key]: height }
      )
    }
  const column = Math.min(width - 2 * CONTENT_INSET, CONTENT_MAX_WIDTH)
  const measured = frames.viewport > 0 && frames.above > 0 && frames.below > 0
  return {
    width: measured
      ? fittedPreviewWidth(
          column,
          frames.viewport,
          frames.above + frames.below + 2 * CONTENT_GAP,
          cap
        )
      : cap,
    onViewport: measure('viewport'),
    onAbove: measure('above'),
    onBelow: measure('below'),
  }
}
const BUTTON_PADDING = 14
const BUTTON_BORDER = 1
const LABEL_FONT_SIZE = 16
type LabelFrame = { width: number; height: number }
type ActionTier = 'halves' | 'content' | 'stacked'
/**
 * How one action row lays out, from its labels measured shrink-wrapped (null while one is not
 * measured yet). Equal halves when every label fits its half on one line, so the rows share one
 * vertical split; otherwise both buttons at their content widths when they still fit side by side;
 * otherwise stacked full width. A label that wrapped (iOS reports it at its longest line) has no
 * one-line width yet, so the row lays out at content width, where it gets one. The 2-pt margins
 * keep a label right at an edge from flipping between tiers.
 */
export function actionRowTier(
  labels: (LabelFrame | undefined)[],
  column: number,
  fontScale: number
): ActionTier | null {
  if (labels.some((label) => label === undefined)) return null
  const measured = labels as LabelFrame[]
  if (measured.length < 2) return 'halves'
  const chrome = 2 * (BUTTON_PADDING + BUTTON_BORDER)
  const half = (column - ACTION_GAP) / 2 - chrome
  const oneLine = (label: LabelFrame) => label.height < LABEL_FONT_SIZE * 1.6 * fontScale
  if (measured.every((label) => oneLine(label) && label.width <= half - 2))
    return 'halves'
  if (!measured.every(oneLine)) return 'content'
  const side = measured.reduce((sum, label) => sum + label.width + chrome, ACTION_GAP)
  return side <= column - 2 ? 'content' : 'stacked'
}
type ActionKind = 'save' | 'share' | 'refresh' | 'retry' | 'settings' | 'cancel'
type ActionRow = (ActionKind | null)[]
/**
 * Action columns. Each row (Save and Share, then a recovery action and Cancel) takes the tier its
 * own labels allow, so status and error copy never move Save and Share; a row not measured yet
 * uses halves. Label frames live in a ref and only a changed tier sets state: even an unchanged
 * update renders the composer again, and a render right after Retry or Open settings mounts made
 * the iOS focus request for that button find it detached (it fell back without posting
 * layoutChanged).
 */
function useActionColumns(rows: [ActionRow, ActionRow]) {
  const { width, fontScale } = useWindowDimensions()
  const column = Math.min(width - 2 * CONTENT_INSET, CONTENT_MAX_WIDTH)
  const scale = `${column}:${fontScale}`
  const frames = useRef({ scale, labels: {} as Partial<Record<ActionKind, LabelFrame>> })
  if (frames.current.scale !== scale) frames.current = { scale, labels: {} }
  const [tiers, setTiers] = useState<Record<string, ActionTier>>({})
  const known = useRef(tiers)
  const current = useRef(rows)
  current.current = rows
  const rowId = (kinds: ActionRow) => kinds.filter(Boolean).join('|')
  const measure =
    (kind: ActionKind) =>
    ({ nativeEvent }: LayoutChangeEvent) => {
      const { labels } = frames.current
      labels[kind] = {
        width: nativeEvent.layout.width,
        height: nativeEvent.layout.height,
      }
      let next = known.current
      for (const kinds of current.current) {
        if (!kinds.includes(kind)) continue
        const present = kinds.filter((name): name is ActionKind => name !== null)
        const tier = actionRowTier(
          present.map((name) => labels[name]),
          column,
          fontScale
        )
        const id = rowId(kinds)
        if (tier !== null && (next[id] ?? 'halves') !== tier)
          next = { ...next, [id]: tier }
      }
      if (next === known.current) return
      known.current = next
      setTiers(next)
    }
  const half = (column - ACTION_GAP) / 2
  // Halves take an explicit width: after a content-width row, Fabric laid two flexBasis 0
  // buttons out unequal (fr-FR Try again at 172 pt beside Cancel at 143 pt on an iPhone SE).
  // A lone button fills its row.
  const styleOf = (kinds: ActionRow): ViewStyle => {
    const tier = tiers[rowId(kinds)] ?? 'halves'
    if (tier !== 'halves') return tierStyle(tier)
    return { ...styles.halves, width: kinds.includes(null) ? '100%' : half }
  }
  return { measure, rows: [styleOf(rows[0]), styleOf(rows[1])] as const }
}
type ActionColumns = ReturnType<typeof useActionColumns>
/** Read at render, after the stylesheet below is created. */
const tierStyle = (tier: ActionTier) =>
  tier === 'halves'
    ? styles.halves
    : tier === 'content'
      ? styles.contentWidth
      : styles.stacked
/** The two action rows: Save and Share (Share only with capability), then recovery and Cancel. */
function actionRows(
  shareCapable: boolean,
  recovery: ActionKind | null
): [ActionRow, ActionRow] {
  return [
    ['save', shareCapable ? 'share' : null],
    [recovery, 'cancel'],
  ]
}
/** The recovery action a state offers beside Cancel, or none. */
function recoveryKind(
  permission: 'denied' | 'permanent' | null,
  error: string | null,
  changed: boolean
): ActionKind | null {
  if (permission === 'permanent') return 'settings'
  if (changed) return 'refresh'
  return error && !shareErrors.has(error) ? 'retry' : null
}
/** The Share button frame in window coordinates, the iPad popover anchor. */
function measureWindowFrame(node: View | null) {
  return new Promise<ShareCardShareAnchor | null>((resolve) => {
    if (!node) return resolve(null)
    const timer = setTimeout(() => resolve(null), ANCHOR_TIMEOUT_MS)
    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer)
      resolve(
        [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
          ? { x, y, width, height }
          : null
      )
    })
  })
}

/**
 * The scroll offset that shows all of a focus target, or null when it is in view already. A result
 * can move focus to an action under the fold (Retry, at a text size where the composer scrolls),
 * and a sighted member must see the control that has focus. A target already fully in view never
 * scrolls: Share can rest just above the fold, and a result that returns focus to it must not
 * move the actions. A rubber-band pull, the negative offset a swipe that dismisses the iOS share
 * sheet can leave, springs back to 0, so visibility is judged where the content comes to rest.
 */
type WindowSpan = { y: number; height: number }
export function revealScrollOffset(
  viewport: WindowSpan,
  frame: WindowSpan,
  offset: number
): number | null {
  const top = frame.y - viewport.y + offset
  const rect = { top, bottom: top + frame.height }
  const resting = { offset: Math.max(0, offset), height: viewport.height }
  return isRectInViewport(rect, resting) ? null : revealOffset(rect, resting)
}
async function revealInScroll(
  scroll: ScrollView | null,
  offset: number,
  target: View | null
): Promise<number | null> {
  const [viewport, frame] = await Promise.all([
    measureWindowFrame(scroll as unknown as View | null),
    measureWindowFrame(target),
  ])
  return viewport && frame ? revealScrollOffset(viewport, frame, offset) : null
}

/**
 * Story 6.9 D4: capability state belongs to one member. A late answer for anyone else is
 * dropped, and the composer clears it on every identity change, sign-out included. A
 * `share_disabled` refusal revokes it for that member until the next open reads it again.
 */
function useShareCardCapability(open: boolean, member: string | null) {
  const [capability, setCapability] = useState<{
    member: string
    nativeShare: boolean
  } | null>(null)
  const currentMember = useRef(member)
  currentMember.current = member
  useEffect(() => {
    setCapability(null)
  }, [member])
  useEffect(() => {
    if (!open || member === null) return
    const abort = new AbortController()
    void shareCardCapabilitiesFromMobile(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && currentMember.current === member)
          setCapability({ member, nativeShare: result.nativeShare === true })
      })
      .catch(() => undefined)
    return () => abort.abort()
  }, [open, member])
  const revoke = (refused: string | null) =>
    setCapability((value) =>
      value?.member === refused ? { member: value.member, nativeShare: false } : value
    )
  return {
    shareCapable:
      capability !== null && capability.member === member && capability.nativeShare,
    revokeShareCapability: revoke,
  }
}

type SaveOwner = { owner: object; generation: number }
function foreignNativeSave(save: SaveOwner | null, generation: number, pending: boolean) {
  return (
    pending &&
    !(
      save !== null &&
      save.generation === generation &&
      ownsPendingShareCardSave(save.owner)
    )
  )
}

function useShareCardWatermark(
  retained: boolean | undefined,
  onChange: React.Dispatch<React.SetStateAction<boolean>> | undefined
) {
  const [local, setLocal] = useState(true)
  return {
    watermark: retained ?? local,
    setWatermark: onChange ?? setLocal,
    setLocalWatermark: setLocal,
  }
}

export function ShareCardComposer({
  source,
  open,
  onClose,
  onRestoreFocus,
  watermark: retainedWatermark,
  onWatermarkChange,
}: {
  source: ShareCardSource | null
  open: boolean
  onClose: () => void
  onRestoreFocus?: () => void
  watermark?: boolean
  onWatermarkChange?: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const { t, i18n } = useTranslation()
  const locale = resolveSupportedLocale(i18n.language) ?? 'en-US'
  const member = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileApplicationUserId
  )
  const pendingNative = useSyncExternalStore(
    subscribeShareCardSave,
    nativeShareCardSavePending
  )
  const { watermark, setWatermark, setLocalWatermark } = useShareCardWatermark(
    retainedWatermark,
    onWatermarkChange
  )
  const [preview, setPreview] = useState<{
    card: PreparedShareCard
    key: string
    member: string | null
    sourceIdentity: string
    renderId: number
  } | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [presentationEpoch, setPresentationEpoch] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [permission, setPermission] = useState<'denied' | 'permanent' | null>(null)
  const restorePending = useRef(false)
  const title = useRef<Text>(null)
  const saveTarget = useRef<View>(null)
  const shareTarget = useRef<View>(null)
  const memberEpoch = useRef(0)
  const recoveryTarget = useRef<View>(null)
  const cancelTarget = useRef<View>(null)
  const scroll = useRef<ScrollView>(null)
  const scrollOffset = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const saveGuard = useRef(false)
  const [saving, setSaving] = useState(false)
  const activeSave = useRef<SaveOwner | null>(null)
  const insets = useModalInsets()
  const previewFit = usePreviewFit()
  const recovery = recoveryKind(permission, error, changed)
  const systemBarsReady = useShareCardStatusBar(
    open && source !== null,
    modalSystemBarsAvailable()
  )
  const available = nativeShareCardSaveAvailable()
  const { shareCapable, revokeShareCapability } = useShareCardCapability(open, member)
  const columns = useActionColumns(actionRows(shareCapable, recovery))
  const shareModule = nativeShareCardShareAvailable()
  const sourceIdentity = JSON.stringify(source)
  const key = JSON.stringify({ source, locale, watermark })
  const [feedbackOwner, setFeedbackOwner] = useState({ member, key })
  const ownsFeedback = feedbackOwner.member === member && feedbackOwner.key === key
  const latest = useRef({ member, key, open })
  latest.current = { member, key, open }
  const current =
    preview?.member === member && preview.sourceIdentity === sourceIdentity
      ? preview
      : null
  const valid = current?.key === key && !changed
  const presentation = `${key}:${current?.renderId}:${presentationEpoch}`
  const pendingOtherSave = foreignNativeSave(
    activeSave.current,
    generation.current,
    pendingNative
  )
  const disabled = saveDisabled(
    valid,
    loaded === presentation,
    busy,
    pendingNative,
    available
  )
  const shareDisabled = saveDisabled(
    valid,
    loaded === presentation,
    busy,
    pendingNative,
    true
  )
  useEffect(() => {
    abortRef.current?.abort()
    generation.current++
    memberEpoch.current++
    setPreview(null)
    setLoaded(null)
    setBusy(false)
    setError(null)
    setMessage(null)
    setPermission(null)
  }, [member])
  useEffect(() => {
    setPreview(null)
    setLoaded(null)
    setLocalWatermark(true)
  }, [
    source?.kind,
    source && ('postId' in source ? source.postId : source.recommendationId),
  ])
  useEffect(() => {
    if (!open || !source) {
      traceShareCardOpener('composer-idle')
      return
    }
    const request = ++generation.current
    const abort = new AbortController()
    abortRef.current = abort
    if (valid) {
      traceShareCardOpener('composer-cached')
      return () => abort.abort()
    }
    traceShareCardOpener('composer-prepare')
    setBusy(true)
    setFeedbackOwner({ member, key })
    setError(null)
    setMessage('preparing')
    void prepareShareCardFromMobile(
      { source, locale, watermark, purpose: 'preview' },
      abort.signal
    )
      .then((card) => {
        if (abort.signal.aborted || generation.current !== request) return
        setPreview({ card, key, member, sourceIdentity, renderId: request })
        setLoaded(null)
        setChanged(false)
        setMessage(null)
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted && generation.current === request) {
          setError(
            failure instanceof ResponseError &&
              [401, 403, 404].includes(failure.response.status)
              ? 'sourceUnavailable'
              : failure instanceof Error && failure.message === 'offline'
                ? 'offline'
                : 'render'
          )
          setMessage(null)
        }
      })
      .finally(() => {
        if (generation.current === request) setBusy(false)
      })
    return () => {
      abort.abort()
      generation.current++
    }
    // Composition key captures all render options and source identifiers.
  }, [open, key, member, refresh])
  // A settings return only rechecks. A new explicit Save is always required.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const captured = { member, key, generation: generation.current }
      if (state === 'active' && open && permission && available)
        void shareCardSavePermission(false)
          .then((result) => {
            if (
              result.granted &&
              latest.current.open &&
              latest.current.member === captured.member &&
              latest.current.key === captured.key &&
              generation.current === captured.generation
            ) {
              setPermission(null)
              setError(null)
            }
          })
          .catch(() => undefined)
    })
    return () => subscription.remove()
  }, [permission, available, member, key, open])
  const restoreFocus = () => {
    if (restorePending.current) {
      restorePending.current = false
      onRestoreFocus?.()
    }
  }
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      generation.current++
      setBusy(false)
      setMessage(null)
    }
  }, [open])
  useEffect(
    () => () => {
      latest.current.open = false
      generation.current++
      abortRef.current?.abort()
    },
    []
  )
  const close = () => {
    abortRef.current?.abort()
    generation.current++
    setBusy(false)
    setMessage(null)
    setLoaded(null)
    setPresentationEpoch((value) => value + 1)
    onClose()
    if (Platform.OS !== 'ios') requestAnimationFrame(restoreFocus)
  }
  const deniedPermission = (canAskAgain: boolean) => {
    setPermission(canAskAgain ? 'denied' : 'permanent')
    setError(canAskAgain ? 'permissionDenied' : 'permissionPermanent')
    setMessage(null)
  }
  const reportSaveFailure = async (failure: unknown, stillCurrent: () => boolean) => {
    const code = saveFailure(failure)
    if (code === 'permissionDenied') {
      const result = await shareCardSavePermission(false).catch(() => ({
        canAskAgain: true,
      }))
      if (stillCurrent()) deniedPermission(result.canAskAgain)
    } else {
      setError(code === 'finishingSave' ? null : code)
      setMessage(code === 'finishingSave' ? code : null)
      if (code === 'previewChanged') setChanged(true)
    }
  }
  const save = async () => {
    if (!source || !current || disabled || saveGuard.current) return
    saveGuard.current = true
    setSaving(true)
    setBusy(true)
    setError(null)
    setMessage('saving')
    setPermission(null)
    const abort = new AbortController()
    abortRef.current = abort
    const captured = { member, key, generation: generation.current }
    const owner = {}
    activeSave.current = { owner, generation: captured.generation }
    const stillCurrent = () =>
      !abort.signal.aborted &&
      latest.current.open &&
      latest.current.member === captured.member &&
      latest.current.key === captured.key &&
      generation.current === captured.generation
    try {
      const permissionResult = await shareCardSavePermission(true)
      if (!stillCurrent()) return
      if (!permissionResult.granted) {
        deniedPermission(permissionResult.canAskAgain)
        return
      }
      const authorized = await prepareShareCardFromMobile(
        {
          source,
          locale,
          watermark,
          purpose: 'save',
          expectedSha256: current.card.sha256,
        },
        abort.signal
      )
      if (!stillCurrent()) return
      if (authorized.sha256 !== current.card.sha256) {
        setChanged(true)
        setError('previewChanged')
        setMessage(null)
        return
      }
      await saveShareCard(current.card, abort.signal, stillCurrent, owner)
      if (stillCurrent()) setMessage('saved')
    } catch (failure) {
      if (stillCurrent()) {
        await reportSaveFailure(failure, stillCurrent)
      }
    } finally {
      saveGuard.current = false
      setSaving(false)
      if (stillCurrent()) setBusy(false)
    }
  }
  const reportShareSettlement = (
    settlement: ShareCardShareSettlement,
    failure: unknown
  ) => {
    // A request-deadline AbortError arrives while the attempt is still current, so it
    // settles as a failure like any other. Real supersession never reaches this function.
    if (failure !== null) {
      if (errorNamed(failure, 'finishingSave')) {
        setError(null)
        setMessage('finishingSave')
        return
      }
      if (sharePreviewChanged(failure)) {
        // The 6.8 stale path: keep the old composition, focus Refresh, block Save and Share.
        setChanged(true)
        setError('previewChanged')
        setMessage(null)
        return
      }
    }
    const feedback = shareFeedbackFor(settlement)
    setError(feedback.error ? feedback.key : null)
    setMessage(feedback.error ? null : feedback.key)
  }
  const share = async () => {
    if (!source || !current || !shareCapable || !shareModule) return
    if (shareDisabled || saveGuard.current) return
    saveGuard.current = true
    const started = Date.now()
    setSaving(true)
    setBusy(true)
    setError(null)
    setMessage('sharing')
    setPermission(null)
    const abort = new AbortController()
    abortRef.current = abort
    const captured = {
      member,
      key,
      generation: generation.current,
      memberEpoch: memberEpoch.current,
      identityEpoch: mobileIdentityEpoch(),
    }
    const owner = {}
    activeSave.current = { owner, generation: captured.generation }
    const stillCurrent = () =>
      !abort.signal.aborted &&
      latest.current.open &&
      latest.current.member === captured.member &&
      latest.current.key === captured.key &&
      generation.current === captured.generation
    let settlement: ShareCardShareSettlement = { target: 'none', outcome: 'failed' }
    let failure: unknown = null
    try {
      settlement = await shareShareCard(
        { source, locale, watermark, expectedSha256: current.card.sha256 },
        {
          signal: abort.signal,
          isCurrent: stillCurrent,
          owner,
          anchor: () => measureWindowFrame(shareTarget.current),
        }
      )
    } catch (error) {
      failure = error
    } finally {
      saveGuard.current = false
      setSaving(false)
      if (stillCurrent()) setBusy(false)
    }
    // Settled and the global lock already released. A sign-out or identity change
    // supersedes the attempt: no feedback and no event. An unmounted composer never advances
    // its epoch, so the process identity epoch is read as well; it also catches a sign-out and
    // return as the same member.
    const superseded = () =>
      memberEpoch.current !== captured.memberEpoch ||
      mobileIdentityEpoch() !== captured.identityEpoch
    if (stillCurrent()) reportShareSettlement(settlement, failure)
    void shareDisabledRefusal(failure).then((refused) => {
      if (refused) revokeShareCapability(captured.member)
    })
    if (superseded()) return
    if (errorNamed(failure, 'finishingSave')) return
    const event = {
      client: Platform.OS === 'android' ? ('android' as const) : ('ios' as const),
      target: settlement.target,
      outcome: settlement.outcome,
      duration_ms: Date.now() - started,
    }
    // Loaded on first use, so the SDK never joins the composer's startup path. A failed
    // load, a throw or a rejection is swallowed: analytics never changes the outcome.
    void import('../src/analytics/mobile-analytics.js')
      .then(({ mobileAnalyticsClient }) => {
        if (!superseded()) trackMobileShareCardShared(mobileAnalyticsClient, event)
      })
      .catch(() => undefined)
  }
  return (
    <EdgeToEdgeModal
      visible={open && source !== null && systemBarsReady}
      animationType="slide"
      onRequestClose={close}
      onDismiss={restoreFocus}
      scrim="#0009"
      onShow={() => {
        restorePending.current = true
        const node = safeFindNodeHandle(title.current)
        if (Platform.OS === 'android' && node)
          void setModalDarkStatusBar(node)?.catch(() => undefined)
        focusShareCardElement(
          pendingOtherSave ? safeFindNodeHandle(cancelTarget.current) : node
        )
      }}
    >
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <ScrollView
          ref={scroll}
          scrollEventThrottle={16}
          onScroll={(event) => {
            scrollOffset.current = event.nativeEvent.contentOffset.y
          }}
          onLayout={previewFit.onViewport}
          contentContainerStyle={styles.content}
        >
          <View style={styles.block} onLayout={previewFit.onAbove}>
            <Text
              ref={title}
              accessibilityRole="header"
              style={styles.heading}
              testID="share-card-title"
            >
              {t('shareCard.title')}
            </Text>
            <PhotoPrivacyHelp source={source} t={t} />
            <View style={styles.row}>
              <Text style={styles.text}>{t('shareCard.watermark')}</Text>
              <Pressable
                accessibilityRole="switch"
                aria-checked={watermark}
                aria-disabled={saving}
                accessibilityLabel={t('shareCard.watermark')}
                accessibilityState={{ checked: watermark, disabled: saving }}
                disabled={saving}
                onPress={() => {
                  setWatermark((value) => !value)
                  setLoaded(null)
                  setChanged(false)
                }}
                style={styles.toggleTarget}
                testID="share-card-watermark"
              >
                <View
                  aria-hidden
                  style={{ pointerEvents: 'none' }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Switch value={watermark} disabled={saving} />
                </View>
              </Pressable>
            </View>
          </View>
          <CardPreview
            key={presentation}
            current={current}
            width={previewFit.width}
            loaded={valid && loaded === presentation}
            onLoad={() => setLoaded(presentation)}
            onError={() => {
              setLoaded(null)
              setError('render')
            }}
          />
          <View style={styles.block} onLayout={previewFit.onBelow}>
            <ComposerFeedback
              onFocusResult={(status) => {
                const target = focusSaveAfter.has(status)
                  ? saveTarget.current
                  : focusShareAfter.has(status)
                    ? shareTarget.current
                    : status === 'finishingSave'
                      ? cancelTarget.current
                      : recoveryTarget.current
                const captured = generation.current
                const isCurrent = () =>
                  latest.current.open &&
                  latest.current.member === member &&
                  latest.current.key === key &&
                  generation.current === captured
                focusShareCardElement(safeFindNodeHandle(target), isCurrent)
                void revealInScroll(scroll.current, scrollOffset.current, target).then(
                  (offset) => {
                    if (offset !== null && isCurrent())
                      scroll.current?.scrollTo({ y: offset, animated: false })
                  }
                )
              }}
              visible={open}
              scope={`${member}:${key}:${presentationEpoch}`}
              pending={pendingOtherSave}
              message={ownsFeedback ? message : null}
              error={ownsFeedback ? error : null}
              available={available}
              t={t}
            />
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled,
                }}
                disabled={disabled}
                onPress={() => void save()}
                style={[styles.button, columns.rows[0]]}
                ref={saveTarget}
                testID="share-card-save"
              >
                <ActionLabel kind="save" columns={columns} t={t} />
              </Pressable>
              <ShareAction
                target={shareTarget}
                capable={shareCapable}
                present={shareModule}
                disabled={shareDisabled}
                onPress={() => void share()}
                columns={columns}
                t={t}
              />
            </View>
            <ShareUnavailable capable={shareCapable} present={shareModule} t={t} />
            <View style={styles.actions}>
              <RecoveryActions
                target={recoveryTarget}
                kind={recovery}
                disabled={busy || pendingNative}
                style={columns.rows[1]}
                columns={columns}
                t={t}
                retry={() => {
                  if (permission === 'denied') {
                    void save()
                  } else {
                    setPreview(null)
                    setChanged(false)
                    setRefresh((n) => n + 1)
                  }
                }}
              />
              <Pressable
                accessibilityRole="button"
                style={[styles.button, columns.rows[1]]}
                onPress={close}
                ref={cancelTarget}
                testID="share-card-cancel"
              >
                <ActionLabel kind="cancel" columns={columns} t={t} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </EdgeToEdgeModal>
  )
}
type Translation = (key: string) => string
function PhotoPrivacyHelp({
  source,
  t,
}: {
  source: ShareCardSource | null
  t: Translation
}) {
  return source?.kind === 'community_post' ? (
    <Text style={styles.text}>{t('shareCard.photoPrivacyHelp')}</Text>
  ) : null
}
function CardPreview({
  current,
  width,
  loaded,
  onLoad,
  onError,
}: {
  current: PreparedPreview | null
  width: number | null
  loaded: boolean
  onLoad: () => void
  onError: () => void
}) {
  if (!current) return null
  return (
    <Image
      key={current.key}
      source={{ uri: `data:image/png;base64,${current.card.pngBase64}` }}
      accessibilityLabel={current.card.accessibilityLabel}
      style={[styles.preview, width !== null && { width, alignSelf: 'center' }]}
      resizeMode="contain"
      testID={shareCardPreviewTestId(loaded, current.card.sha256)}
      onLoad={onLoad}
      onError={onError}
    />
  )
}
function ComposerFeedback({
  onFocusResult,
  visible,
  scope,
  pending,
  message,
  error,
  available,
  t,
}: {
  onFocusResult: (status: string) => void
  visible: boolean
  scope: string
  pending: boolean
  message: string | null
  error: string | null
  available: boolean
  t: Translation
}) {
  const announced = useRef<string | null>(null)
  useEffect(() => {
    announced.current = null
  }, [scope, visible])
  useEffect(() => {
    if (!visible) return
    const key = !available
      ? 'nativeSaveUnavailable'
      : (error ?? (pending ? 'finishingSave' : message))
    if (!key) return
    const announcement = t(`shareCard.${key}`)
    if (announced.current === announcement) return
    announced.current = announcement
    if (!['preparing', 'saving', 'sharing', 'nativeSaveUnavailable'].includes(key))
      onFocusResult(key)
    if (Platform.OS !== 'ios') return
    AccessibilityInfo.announceForAccessibilityWithOptions(announcement, {
      queue: available && !error,
    })
  }, [visible, scope, available, error, pending, message, t, onFocusResult])
  const status = Boolean(pending || message)
  const failure = !available || Boolean(error)
  const { width, fontScale } = useWindowDimensions()
  // The height is reserved without a placeholder node: a hidden placeholder Text made Android
  // TalkBack leave the title for the next element when the composer opened.
  return (
    <View
      style={[
        styles.feedbackSlot,
        { minHeight: feedbackSlotHeight(width, fontScale, PixelRatio.get()) },
      ]}
    >
      {status && (
        <Text
          testID="share-card-feedback"
          accessibilityLiveRegion="polite"
          style={[styles.text, styles.feedbackLine]}
        >
          {pending ? t('shareCard.finishingSave') : t(`shareCard.${message}`)}
        </Text>
      )}
      {failure && (
        <Text
          testID="share-card-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.error, styles.feedbackLine]}
        >
          {t(`shareCard.${available ? error : 'nativeSaveUnavailable'}`)}
        </Text>
      )}
    </View>
  )
}
/**
 * Story 6.9: Share sits after Save with its own ref. Without the native module it stays
 * visible but statically disabled, its localized reason below the row, and pressing it does
 * nothing.
 */
function ShareAction({
  target,
  capable,
  present,
  disabled,
  onPress,
  columns,
  t,
}: {
  target: React.Ref<View>
  capable: boolean
  present: boolean
  disabled: boolean
  onPress: () => void
  columns: ActionColumns
  t: Translation
}) {
  if (!capable) return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || !present }}
      accessibilityHint={present ? undefined : t('shareCard.shareUnavailable')}
      disabled={disabled || !present}
      onPress={present ? onPress : undefined}
      style={[styles.button, columns.rows[0]]}
      ref={target}
      testID="share-card-share"
    >
      <ActionLabel kind="share" columns={columns} t={t} />
    </Pressable>
  )
}
/** The reason a statically disabled Share gives, below its row so it never joins the pair. */
function ShareUnavailable({
  capable,
  present,
  t,
}: {
  capable: boolean
  present: boolean
  t: Translation
}) {
  if (!capable || present) return null
  return (
    <Text testID="share-card-share-unavailable" style={styles.text}>
      {t('shareCard.shareUnavailable')}
    </Text>
  )
}
/** An action's label, shrink-wrapped so its measured width is the width it needs. */
function ActionLabel({
  kind,
  columns,
  t,
}: {
  kind: ActionKind
  columns: ActionColumns
  t: Translation
}) {
  return (
    <Text style={styles.buttonText} onLayout={columns.measure(kind)}>
      {t(`shareCard.${kind === 'settings' ? 'openSettings' : kind}`)}
    </Text>
  )
}
function RecoveryActions({
  target,
  kind,
  disabled,
  style,
  columns,
  t,
  retry,
}: {
  target: React.Ref<View>
  kind: ActionKind | null
  disabled: boolean
  style: ViewStyle
  columns: ActionColumns
  t: Translation
  retry: () => void
}) {
  if (kind === 'settings')
    return (
      <Pressable
        ref={target}
        testID="share-card-settings"
        accessibilityRole="button"
        style={[styles.button, style]}
        onPress={() => {
          void Linking.openSettings()
        }}
      >
        <ActionLabel kind="settings" columns={columns} t={t} />
      </Pressable>
    )
  if (kind === null) return null
  return (
    <Pressable
      ref={target}
      testID={`share-card-${kind}`}
      accessibilityRole="button"
      style={[styles.button, style]}
      disabled={disabled}
      onPress={retry}
    >
      <ActionLabel kind={kind} columns={columns} t={t} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#F7F3E8' },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH + 2 * CONTENT_INSET,
    alignSelf: 'center',
    paddingHorizontal: CONTENT_INSET,
    gap: CONTENT_GAP,
  },
  block: { gap: CONTENT_GAP },
  /** An action row; its buttons take `halves`, `contentWidth` or `stacked` (actionRowTier). */
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: CONTENT_GAP,
    columnGap: ACTION_GAP,
  },
  heading: { color: '#292724', fontSize: 26, fontWeight: '600' },
  text: { color: '#292724', fontSize: 16, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  toggleTarget: {
    minHeight: 48,
    minWidth: 65,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { width: '100%', aspectRatio: PREVIEW_ASPECT },
  error: { color: '#7A1F2D', fontSize: 16 },
  feedbackSlot: { gap: 16 },
  feedbackLine: { lineHeight: FEEDBACK_LINE_HEIGHT },
  // Every tier sets the same flex props, so a tier change never leaves one behind.
  halves: { flexBasis: 'auto', flexGrow: 0, flexShrink: 0 },
  contentWidth: { flexBasis: 'auto', flexGrow: 1, flexShrink: 1, width: 'auto' },
  stacked: { flexBasis: 'auto', flexGrow: 0, flexShrink: 1, width: '100%' },
  button: {
    minHeight: 48,
    padding: BUTTON_PADDING,
    borderWidth: BUTTON_BORDER,
    borderColor: '#B28D46',
    borderRadius: 8,
  },
  buttonText: {
    alignSelf: 'center',
    color: '#292724',
    fontSize: LABEL_FONT_SIZE,
    textAlign: 'center',
  },
})
