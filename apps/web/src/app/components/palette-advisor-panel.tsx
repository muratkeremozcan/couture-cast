// Story 5.4 Task 7 owner: the `/palette` route's body, the colour palette &
// beauty/accessory advisor.
//
// It follows `premium-theme-section.tsx`'s `SectionState`/`resolveSectionView`
// shape deliberately, and four things about it are load-bearing rather than
// stylistic:
//
// - **No English ever reaches the screen from a thrown message.**
//   `lib/palette-advisor.ts` classifies every failure into a
//   `PaletteAdvisorFailureReason`, and this file maps each member onto a
//   `commerce.premium.palette.*` key or onto a state change. The server's own
//   `PALETTE_CONSENT_REQUIRED_MESSAGE` / `PALETTE_ANALYSIS_DISABLED_MESSAGE` are
//   untranslated and are never rendered.
// - **No shade name is hardcoded.** Every card renders `t(card.labelKey)` from
//   the server's `ADVISOR_RULES` entry (Decision 6). The only literal colour in
//   this file is the swatch's own `swatchHex`, which is a colour, not copy.
// - **The sponsored disclosure precedes the control it describes**, in reading
//   order, as a sibling text node -- never a tooltip and never only an
//   accessible name. Same shape `commerce-preferences-section.tsx` established.
// - **Revoking consent is an erase**, so it is confirmed inline rather than
//   fired on first press. A native `confirm()` would block the page and is
//   untranslatable; the confirmation is a rendered step with its own catalog
//   key.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ADVISOR_RULES_VERSION,
  type AdvisorRecommendationCard,
  type PaletteAdvisorProfile,
  type PaletteAnalysisFailureReason,
} from '@couture/api-client/contracts/http'
import { mintAffiliateClickFromWeb, openAffiliatePartnerSite } from '../../lib/commerce'
import {
  analyzeWardrobePaletteFromWeb,
  erasePaletteAdvisorFromWeb,
  generateIdempotencyKey,
  getPaletteAdvisorFromWeb,
  hasWebSession,
  paletteAdvisorFailureReason,
  setPaletteConsentFromWeb,
  updateAdvisorRecommendationFromWeb,
  uploadPaletteSelfieFromWeb,
  type PaletteSelfieUploadState,
} from '../../lib/palette-advisor'

/**
 * True when a stored palette was derived under a rule table this build has
 * replaced.
 *
 * WHAT IS STALE IS THE PALETTE, NOT THE CARDS BENEATH IT.
 * `PaletteAdvisorService.resolveRecommendations` builds every card from the
 * CURRENT `ADVISOR_RULES` keyed on the stored undertone and depth, and never
 * consults `analysis_version`, so the shades on screen are always this build's.
 * What predates a rules bump is the derivation itself -- the undertone, the
 * depth and the confidence -- and there is no way to refresh those without
 * re-running an analysis, because Decision 8 purged the selfie the moment the
 * last one terminated.
 *
 * Without the note this returns, the panel is indistinguishable from a current
 * one: the result reads as fresh, and a reader has no reason to press a source
 * button they have already used. `SourceChoice` is already on screen in this
 * state, so the affordance costs nothing beyond the sentence that explains it.
 *
 * A module-level function rather than an inline expression because the panel
 * sits on a complexity ceiling of 15 and this is two more branches.
 */
function isPaletteStale(analysis: PaletteAdvisorProfile['analysis']): boolean {
  return (
    analysis?.status === 'ready' && analysis.analysisVersion !== ADVISOR_RULES_VERSION
  )
}

const UNAVAILABLE_HINT_ID = 'palette-advisor-unavailable-hint'
const WARDROBE_HINT_ID = 'palette-advisor-wardrobe-hint'
const SELFIE_HINT_ID = 'palette-advisor-selfie-hint'
const SELFIE_INPUT_ID = 'palette-advisor-selfie-input'

/**
 * `checking` is the server render and the first client tick, before
 * `sessionStorage` can be read, so hydration never reconciles two trees. It
 * renders the heading and the intro and nothing else, which is also what
 * `loading` renders.
 */
type PanelState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

/** What is in flight, so exactly one control can be busy at a time. */
type BusyKind = null | 'consent' | 'erase' | 'wardrobe' | 'selfie' | 'recommendation'

/**
 * The last dismissal, kept only in memory so the reader can undo it before
 * navigating away.
 *
 * A dismissed card is omitted from the next `GET` entirely (AC 6), which is
 * exactly right for "it does not reappear" and leaves nothing on screen to undo
 * from. Holding the item key here is what makes the undo control possible
 * without publishing a third state on the wire.
 */
type LastDismissal = { itemKey: string; slot: AdvisorRecommendationCard['slot'] }

interface PanelView {
  showLocked: boolean
  showConsent: boolean
  showSources: boolean
  showUnavailableNote: boolean
}

/**
 * What the body renders, in one place.
 *
 * Entitlement reaches this panel only as the server-resolved `isEntitled` on
 * the advisor response, so the client never combines two endpoints and never
 * has two moments in time to disagree about. Three states deliberately render
 * neither the advisor nor the locked panel: `checking`, `loading` and
 * `load_failed`. The first two are transient; the third is the honest one -- a
 * read that failed tells us nothing about entitlement, and showing a subscriber
 * an upsell for something they already pay for would be worse than showing the
 * error alone.
 */
function resolvePanelView(
  panelState: PanelState,
  profile: PaletteAdvisorProfile | null
): PanelView {
  const resolved = panelState === 'ready' ? profile : null
  const entitled = resolved?.isEntitled === true

  return {
    showLocked: panelState === 'signed_out' || (resolved !== null && !entitled),
    showConsent: entitled,
    showSources: entitled && resolved?.hasConsent === true,
    showUnavailableNote: entitled && resolved?.analysisEnabled === false,
  }
}

/** The status key for the current analysis, or null when there is nothing to say. */
function statusKey(
  profile: PaletteAdvisorProfile | null,
  uploadState: PaletteSelfieUploadState | null
): string | null {
  if (uploadState !== null) {
    return uploadState === 'committing'
      ? 'commerce.premium.palette.status.processing'
      : 'commerce.premium.palette.status.uploading'
  }
  const analysis = profile?.analysis ?? null
  if (!analysis) {
    return 'commerce.premium.palette.status.idle'
  }
  switch (analysis.status) {
    case 'pending_upload':
    case 'bytes_uploaded':
      return 'commerce.premium.palette.status.uploading'
    case 'processing':
      return 'commerce.premium.palette.status.processing'
    case 'ready':
      return 'commerce.premium.palette.status.ready'
    case 'failed':
      return 'commerce.premium.palette.status.failed'
  }
}

/**
 * Exhaustive over the contract enum on purpose: a failure reason added to
 * `paletteAnalysisFailureReasonSchema` fails to typecheck here until it has
 * copy, so the panel cannot silently render a blank explanation.
 */
const FAILURE_KEYS: Record<PaletteAnalysisFailureReason, string> = {
  no_face: 'commerce.premium.palette.failure.noFace',
  low_quality: 'commerce.premium.palette.failure.lowQuality',
  privacy_violation: 'commerce.premium.palette.failure.privacyViolation',
  insufficient_wardrobe: 'commerce.premium.palette.failure.insufficientWardrobe',
  timeout: 'commerce.premium.palette.failure.timeout',
  storage_error: 'commerce.premium.palette.failure.storageError',
}

/**
 * The locked upsell for a signed-out or non-entitled reader.
 *
 * Same panel shape and `data-testid` convention as `premium-theme-section.tsx`'s
 * locked branch. The body splits by audience because the sentence that is true
 * for a signed-in reader ("subscribe from Settings") is not the first step for
 * a signed-out one.
 */
function LockedPanel({ isSignedOut }: { isSignedOut: boolean }) {
  const { t } = useTranslation()

  return (
    <div
      className="mt-6 space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4"
      data-testid="palette-advisor-locked"
    >
      <p className="text-sm font-medium text-white">
        {t('commerce.premium.palette.locked.title')}
      </p>
      <p className="text-sm text-neutral-300">
        {t(
          isSignedOut
            ? 'commerce.premium.palette.locked.signedOutBody'
            : 'commerce.premium.palette.locked.body'
        )}
      </p>
    </div>
  )
}

function RecommendationCard({
  card,
  isBusy,
  onSave,
  onDismiss,
  onUndoSave,
  onSponsoredActivate,
  sponsoredError,
}: {
  card: AdvisorRecommendationCard
  isBusy: boolean
  onSave: () => void
  onDismiss: () => void
  onUndoSave: () => void
  onSponsoredActivate: () => void
  sponsoredError: string | null
}) {
  const { t } = useTranslation()

  return (
    <li
      className="rounded-lg border border-neutral-700 bg-neutral-900 p-4"
      data-testid={`palette-advisor-card-${card.itemKey}`}
    >
      <p className="text-xs uppercase tracking-wider text-neutral-400">
        {t(`commerce.premium.palette.slot.${card.slot}`)}
      </p>
      <p className="mt-2 flex items-center gap-2 text-base font-semibold text-white">
        {/*
          The one literal colour in this file, and it is a colour rather than
          copy: `swatchHex` comes from the server's ADVISOR_RULES entry and is
          pinned against `ADVISOR_SWATCH_CARD_BACKGROUND` at SC 1.4.11's 3:1
          non-text floor by the contract's own test. It is `aria-hidden` and
          carries no information the label does not, so the shade is never
          conveyed by colour alone.
        */}
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded-full border border-white/40"
          style={{ backgroundColor: card.swatchHex }}
          data-testid={`palette-advisor-swatch-${card.itemKey}`}
        />
        <span data-testid={`palette-advisor-label-${card.itemKey}`}>
          {t(card.labelKey)}
        </span>
      </p>

      {card.sponsored && (
        <div
          className="mt-4 rounded-md border border-neutral-700 bg-neutral-950 p-3"
          data-testid={`palette-advisor-sponsored-${card.itemKey}`}
        >
          {/*
            AC 6: the disclosure is a sibling text node BEFORE the control it
            describes, in reading order. Not a tooltip, not only an accessible
            name, and never after the button.
          */}
          <p
            className="text-xs leading-relaxed text-neutral-300"
            data-testid={`palette-advisor-sponsored-disclosure-${card.itemKey}`}
          >
            {t('commerce.premium.palette.sponsored.disclosure')}
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            {t('commerce.premium.palette.sponsored.partnerLabel', {
              partner: card.sponsored.partnerDisplayName,
            })}
          </p>
          <p className="mt-1 text-sm text-white">{card.sponsored.offerTitle}</p>
          <button
            type="button"
            className="mt-3 min-h-[44px] rounded-md bg-[#C9A14A] px-4 text-sm font-semibold text-[#111111]"
            data-testid={`palette-advisor-sponsored-cta-${card.itemKey}`}
            onClick={onSponsoredActivate}
          >
            {t('commerce.premium.palette.sponsored.cta')}
          </button>
          {sponsoredError && (
            <p
              role="alert"
              className="mt-2 text-xs text-red-300"
              data-testid={`palette-advisor-sponsored-error-${card.itemKey}`}
            >
              {sponsoredError}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {card.saved ? (
          <>
            <span
              className="text-sm font-medium text-white"
              data-testid={`palette-advisor-saved-${card.itemKey}`}
            >
              {t('commerce.premium.palette.actions.saved')}
            </span>
            <button
              type="button"
              className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
              data-testid={`palette-advisor-unsave-${card.itemKey}`}
              disabled={isBusy}
              onClick={onUndoSave}
            >
              {t('commerce.premium.palette.actions.undo')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
            data-testid={`palette-advisor-save-${card.itemKey}`}
            disabled={isBusy}
            onClick={onSave}
          >
            {t('commerce.premium.palette.actions.save')}
          </button>
        )}
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
          data-testid={`palette-advisor-dismiss-${card.itemKey}`}
          disabled={isBusy}
          onClick={onDismiss}
        >
          {t('commerce.premium.palette.actions.dismiss')}
        </button>
      </div>
    </li>
  )
}

/**
 * The consent gate, extracted from `PaletteAdvisorPanel` rather than inlined.
 *
 * Not a style choice: the panel is a state machine with five async writes and
 * seven render branches, and holding this block inline pushed its cyclomatic
 * complexity past the repository's ceiling of 15. Splitting on the boundaries
 * the ACs already draw -- consent (AC 1), sources (AC 2/3), results (AC 4) --
 * keeps each piece readable and leaves the panel owning state transitions only.
 */
function ConsentBlock({
  hasConsent,
  isBusy,
  isAnalysisEnabled,
  showUnavailableNote,
  confirmingErase,
  onGrant,
  onStartErase,
  onCancelErase,
  onConfirmErase,
}: {
  hasConsent: boolean
  isBusy: boolean
  isAnalysisEnabled: boolean
  showUnavailableNote: boolean
  confirmingErase: boolean
  onGrant: () => void
  onStartErase: () => void
  onCancelErase: () => void
  onConfirmErase: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-6" data-testid="palette-advisor-consent">
      <h3 className="text-base font-semibold text-white">
        {t('commerce.premium.palette.consent.title')}
      </h3>
      {/*
        The consent explanation is a sibling text node before the control it
        gates, in reading order -- the same rule AC 6 states for the
        sponsored disclosure, applied to the consent itself.
      */}
      <p
        className="mt-2 text-sm leading-relaxed text-neutral-200"
        data-testid="palette-advisor-consent-body"
      >
        {t('commerce.premium.palette.consent.body')}
      </p>

      {hasConsent ? (
        <div className="mt-4 space-y-3">
          <p
            className="text-sm font-medium text-white"
            data-testid="palette-advisor-consent-granted"
          >
            {t('commerce.premium.palette.consent.granted')}
          </p>
          {confirmingErase ? (
            <div className="space-y-3" data-testid="palette-advisor-erase-confirm">
              <p className="text-sm text-neutral-200">
                {t('commerce.premium.palette.deleteConfirm')}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="min-h-[44px] rounded-md border border-red-400 px-4 text-sm font-semibold text-red-200"
                  data-testid="palette-advisor-erase-confirm-yes"
                  disabled={isBusy}
                  onClick={onConfirmErase}
                >
                  {t('commerce.premium.palette.consent.revoke')}
                </button>
                <button
                  type="button"
                  className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
                  data-testid="palette-advisor-erase-confirm-no"
                  onClick={onCancelErase}
                >
                  {t('commerce.premium.palette.actions.undo')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
              data-testid="palette-advisor-consent-revoke"
              disabled={isBusy}
              onClick={onStartErase}
            >
              {t('commerce.premium.palette.consent.revoke')}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="mt-4 min-h-[44px] rounded-md bg-white px-4 text-sm font-semibold text-neutral-900 disabled:opacity-70"
          data-testid="palette-advisor-consent-grant"
          aria-describedby={showUnavailableNote ? UNAVAILABLE_HINT_ID : undefined}
          disabled={isBusy || !isAnalysisEnabled}
          onClick={onGrant}
        >
          {t('commerce.premium.palette.consent.grant')}
        </button>
      )}
    </div>
  )
}

/**
 * The two derivation sources, and the reason each one exists.
 *
 * Every control here is disabled when the kill switch is off, and every one
 * points `aria-describedby` at the note that explains why, so a disabled
 * control is never disabled without a reason.
 */
function SourceChoice({
  isBusy,
  isAnalysisEnabled,
  showUnavailableNote,
  onAnalyzeWardrobe,
  onSelfieChosen,
}: {
  isBusy: boolean
  isAnalysisEnabled: boolean
  showUnavailableNote: boolean
  onAnalyzeWardrobe: () => void
  onSelfieChosen: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-8" data-testid="palette-advisor-sources">
      <p
        id={WARDROBE_HINT_ID}
        className="text-sm text-neutral-300"
        data-testid="palette-advisor-wardrobe-hint"
      >
        {t('commerce.premium.palette.source.wardrobeHint')}
      </p>
      <button
        type="button"
        className="mt-2 min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white disabled:opacity-70"
        data-testid="palette-advisor-source-wardrobe"
        aria-describedby={
          showUnavailableNote
            ? `${WARDROBE_HINT_ID} ${UNAVAILABLE_HINT_ID}`
            : WARDROBE_HINT_ID
        }
        disabled={isBusy || !isAnalysisEnabled}
        onClick={onAnalyzeWardrobe}
      >
        {t('commerce.premium.palette.source.wardrobe')}
      </button>

      <p
        id={SELFIE_HINT_ID}
        className="mt-6 text-sm text-neutral-300"
        data-testid="palette-advisor-selfie-hint"
      >
        {t('commerce.premium.palette.source.selfieHint')}
      </p>
      <label
        htmlFor={SELFIE_INPUT_ID}
        className="mt-2 block text-sm font-medium text-white"
      >
        {t('commerce.premium.palette.source.selfie')}
      </label>
      <input
        id={SELFIE_INPUT_ID}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="mt-2 block text-sm text-neutral-200"
        data-testid="palette-advisor-selfie-input"
        aria-describedby={
          showUnavailableNote
            ? `${SELFIE_HINT_ID} ${UNAVAILABLE_HINT_ID}`
            : SELFIE_HINT_ID
        }
        disabled={isBusy || !isAnalysisEnabled}
        onChange={onSelfieChosen}
      />
    </div>
  )
}

/**
 * The derived palette, and the honest note that comes with a depth-less one.
 *
 * Extracted for the same complexity reason `ConsentBlock` is, and because the
 * `depth === null` branch is AC 4's whole point: a wardrobe-sourced palette
 * yields undertone-family foundation guidance rather than a shade match, and
 * the copy says why instead of hiding the difference.
 */
function PaletteResult({
  undertone,
  depth,
  confidenceLabel,
  isStale,
}: {
  undertone: string
  depth: string | null
  confidenceLabel: string | null
  isStale: boolean
}) {
  const { t } = useTranslation()

  return (
    <>
      {/*
        Precedes the numbers it qualifies, the same way the kill-switch note
        precedes the controls it explains. A caveat printed under a reading the
        reader has already taken as current is a caveat they never see.
      */}
      {isStale && (
        <p
          className="mt-4 text-sm text-neutral-300"
          data-testid="palette-advisor-stale-version"
        >
          {t('commerce.premium.palette.staleVersion')}
        </p>
      )}

      <dl className="mt-6 space-y-2 text-sm" data-testid="palette-advisor-result">
        <div className="flex gap-2">
          <dt className="text-neutral-400">
            {t('commerce.premium.palette.result.undertone')}
          </dt>
          <dd className="font-medium text-white" data-testid="palette-advisor-undertone">
            {t(`commerce.premium.palette.undertone.${undertone}`)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-400">
            {t('commerce.premium.palette.result.depth')}
          </dt>
          <dd className="font-medium text-white" data-testid="palette-advisor-depth">
            {depth
              ? t(`commerce.premium.palette.depth.${depth}`)
              : t('commerce.premium.palette.result.depthUnknown')}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-400">
            {t('commerce.premium.palette.result.confidence')}
          </dt>
          <dd className="font-medium text-white" data-testid="palette-advisor-confidence">
            {confidenceLabel}
          </dd>
        </div>
      </dl>

      {depth === null && (
        <p
          className="mt-3 text-sm text-neutral-300"
          data-testid="palette-advisor-foundation-depth-unknown"
        >
          {t('commerce.premium.palette.foundationDepthUnknown')}
        </p>
      )}
    </>
  )
}

/**
 * The live status line and, when an analysis terminated badly, why.
 *
 * The failure copy is looked up from `FAILURE_KEYS`, which is exhaustive over
 * the contract enum, so a reason added to
 * `paletteAnalysisFailureReasonSchema` fails to typecheck until it has copy in
 * all ten catalogs. The server's own message never reaches this element.
 */
function AnalysisStatus({
  statusKey,
  failureReason,
}: {
  statusKey: string | null
  failureReason: PaletteAnalysisFailureReason | null
}) {
  const { t } = useTranslation()

  return (
    <>
      {statusKey && (
        <p
          role="status"
          className="mt-6 text-sm text-neutral-200"
          data-testid="palette-advisor-status"
        >
          {t(statusKey)}
        </p>
      )}

      {failureReason && (
        <p
          role="alert"
          className="mt-2 text-sm text-red-300"
          data-testid="palette-advisor-failure"
        >
          {t(FAILURE_KEYS[failureReason])}
        </p>
      )}
    </>
  )
}

export function PaletteAdvisorPanel() {
  const { t, i18n } = useTranslation()
  const [panelState, setPanelState] = useState<PanelState>('checking')
  const [profile, setProfile] = useState<PaletteAdvisorProfile | null>(null)
  const [busy, setBusy] = useState<BusyKind>(null)
  const [uploadState, setUploadState] = useState<PaletteSelfieUploadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Keyed by `itemKey`: a failed handoff must not paint an alert on every card. */
  const [sponsoredErrorItemKey, setSponsoredErrorItemKey] = useState<string | null>(null)
  const [confirmingErase, setConfirmingErase] = useState(false)
  const [lastDismissal, setLastDismissal] = useState<LastDismissal | null>(null)

  /** Every in-flight write, so unmounting cancels them. */
  const writeControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => writeControllerRef.current?.abort(), [])

  /*
   * Resolved outside the effect and depended on by value, mirroring
   * `PremiumThemeSection`: depending on `t` itself would tie the effect to a
   * function identity and risk a request loop.
   */
  const loadErrorMessage = t('commerce.premium.palette.loadError')

  useEffect(() => {
    if (!hasWebSession()) {
      setPanelState('signed_out')
      return
    }

    const controller = new AbortController()
    setPanelState('loading')

    void (async () => {
      try {
        const next = await getPaletteAdvisorFromWeb(controller.signal)
        if (controller.signal.aborted) return
        setProfile(next)
        setPanelState('ready')
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return
        if (paletteAdvisorFailureReason(loadError) === 'signed_out') {
          // An expired or cleared token is not a broken read. Show the locked
          // panel rather than an error the reader cannot act on, and never
          // surface the guard's untranslated developer string.
          setPanelState('signed_out')
          return
        }
        setError(loadErrorMessage)
        setPanelState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [loadErrorMessage])

  /**
   * Re-reads the server's view without touching the busy state.
   *
   * Used only where a write was refused because the server already knows
   * something the panel does not (a running analysis), where the honest answer
   * is the server's current state rather than an error line.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getPaletteAdvisorFromWeb()
      setProfile(next)
      setPanelState('ready')
    } catch {
      // A failed refresh leaves the last known state on screen rather than
      // blanking a panel the reader is mid-interaction with.
    }
  }, [])

  /**
   * A rejected write re-resolves the panel, it does not just print a line.
   *
   * Entitlement can lapse, consent can be revoked from another device and the
   * kill switch can flip while this page is open. Handling those as error text
   * alone leaves `isEntitled` / `analysisEnabled` / `hasConsent` stale, so every
   * further press fails the same way and the locked panel, the consent gate and
   * the kill-switch note all become unreachable from that state. Folding the
   * rejection back into `profile` renders the localized explanation the
   * catalogs already carry, and costs no extra request.
   */
  const applyWriteFailure = useCallback(
    (writeError: unknown, fallbackKey: string): void => {
      switch (paletteAdvisorFailureReason(writeError)) {
        case 'signed_out':
          setProfile(null)
          setPanelState('signed_out')
          return
        case 'not_entitled':
          setProfile((current) =>
            current === null ? null : { ...current, isEntitled: false }
          )
          return
        case 'no_consent':
          setProfile((current) =>
            current === null ? null : { ...current, hasConsent: false }
          )
          return
        case 'analysis_disabled':
          setProfile((current) =>
            current === null ? null : { ...current, analysisEnabled: false }
          )
          return
        case 'in_progress':
          // The server already holds a running analysis. Nothing is wrong; the
          // status line below is the answer, so re-read rather than shout.
          void refresh()
          return
        default:
          setError(t(fallbackKey))
      }
    },
    [refresh, t]
  )

  /** One write path, so every control shares the abort, busy and failure handling. */
  const runWrite = useCallback(
    async (
      kind: Exclude<BusyKind, null>,
      fallbackKey: string,
      write: (signal: AbortSignal) => Promise<PaletteAdvisorProfile>
    ): Promise<void> => {
      if (busy !== null) return

      if (!hasWebSession()) {
        // The session is re-read here, not trusted from mount. Signing out in
        // another tab leaves this panel rendered and interactive, and without
        // this check the write would fail inside the lib and surface
        // PALETTE_ADVISOR_SIGNED_OUT_MESSAGE -- a developer string with no
        // catalog entry, so English in all ten locales.
        setProfile(null)
        setError(null)
        setPanelState('signed_out')
        return
      }

      const controller = new AbortController()
      writeControllerRef.current = controller
      setBusy(kind)
      setError(null)

      try {
        const next = await write(controller.signal)
        if (controller.signal.aborted) return
        setProfile(next)
        setPanelState('ready')
      } catch (writeError: unknown) {
        if (controller.signal.aborted) return
        applyWriteFailure(writeError, fallbackKey)
      } finally {
        if (writeControllerRef.current === controller) {
          writeControllerRef.current = null
        }
        if (!controller.signal.aborted) {
          setBusy(null)
          setUploadState(null)
        }
      }
    },
    [applyWriteFailure, busy]
  )

  function handleGrantConsent(): void {
    void runWrite('consent', 'commerce.premium.palette.saveError', (signal) =>
      setPaletteConsentFromWeb(true, signal)
    )
  }

  /**
   * Withdrawal runs `DELETE`, not `POST /consent { granted: false }`.
   *
   * The two do the same thing server-side -- revoking IS the erase path
   * (Decision 5/9) -- but they are gated differently on the way in: the consent
   * route mounts `PremiumEntitlementGuard` and checks the kill switch, and
   * `DELETE` deliberately does neither. Routing withdrawal through the guarded
   * one would mean a reader whose subscription lapsed, or who opened this page
   * while `color_analysis_enabled` was off, could no longer erase data the app
   * still holds about their face. That is the exact case Decision 9 leaves
   * `DELETE` ungated for.
   */
  function handleConfirmErase(): void {
    setConfirmingErase(false)
    setLastDismissal(null)
    void runWrite('erase', 'commerce.premium.palette.saveError', (signal) =>
      erasePaletteAdvisorFromWeb(signal)
    )
  }

  function handleAnalyzeWardrobe(): void {
    setLastDismissal(null)
    void runWrite('wardrobe', 'commerce.premium.palette.saveError', (signal) =>
      analyzeWardrobePaletteFromWeb(signal)
    )
  }

  function handleSelfieChosen(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    // Reset immediately so choosing the same file twice still fires `change`.
    event.target.value = ''
    if (!file) return

    setLastDismissal(null)
    const imagePreview = URL.createObjectURL(file)
    const idempotencyKey = generateIdempotencyKey()
    void runWrite('selfie', 'commerce.premium.palette.saveError', async (signal) => {
      try {
        return await uploadPaletteSelfieFromWeb({
          imagePreview,
          idempotencyKey,
          signal,
          onStateChange: setUploadState,
        })
      } finally {
        // The object URL is the only local handle on the image and it is
        // released whichever way the upload ends. The bytes themselves are
        // purged server-side the moment the analysis terminates (Decision 8).
        URL.revokeObjectURL(imagePreview)
      }
    })
  }

  function handleRecommendation(
    card: AdvisorRecommendationCard,
    action: 'saved' | 'dismissed' | null
  ): void {
    if (action === 'dismissed') {
      setLastDismissal({ itemKey: card.itemKey, slot: card.slot })
    }
    void runWrite('recommendation', 'commerce.premium.palette.saveError', (signal) =>
      updateAdvisorRecommendationFromWeb(
        { itemKey: card.itemKey, slot: card.slot, action },
        signal
      )
    )
  }

  function handleUndoDismiss(): void {
    const dismissal = lastDismissal
    if (!dismissal) return
    setLastDismissal(null)
    void runWrite('recommendation', 'commerce.premium.palette.saveError', (signal) =>
      updateAdvisorRecommendationFromWeb(
        { itemKey: dismissal.itemKey, slot: dismissal.slot, action: null },
        signal
      )
    )
  }

  async function handleSponsoredActivate(card: AdvisorRecommendationCard): Promise<void> {
    const sponsored = card.sponsored
    const profileId = profile?.profileId ?? null
    if (!sponsored || !profileId) return

    setSponsoredErrorItemKey(null)
    try {
      const redirectUrl = await mintAffiliateClickFromWeb({
        offerId: sponsored.offerId,
        // Decision 7: the advisor's `recommendationId` is the PaletteProfile id.
        // The server re-resolves it from the session and does not trust this
        // value; sending it keeps the request truthful rather than filler.
        recommendationId: profileId,
        surface: 'palette_advisor',
        platform: 'web',
      })
      // Only navigate once the click is attributed. Traffic the partner cannot
      // attribute is worth nothing to them and cannot be audited by us, so a
      // failed mint stops here.
      if (!openAffiliatePartnerSite(redirectUrl)) {
        setSponsoredErrorItemKey(card.itemKey)
      }
    } catch {
      setSponsoredErrorItemKey(card.itemKey)
    }
  }

  const view = resolvePanelView(panelState, profile)
  const analysis = profile?.analysis ?? null
  const recommendations = profile?.recommendations ?? []
  const currentStatusKey = view.showSources ? statusKey(profile, uploadState) : null

  /**
   * The confidence, as the reader's own language writes a percentage.
   *
   * `Intl.NumberFormat` rather than a hand-built `${x * 100}%`: the percent sign
   * is spaced in French and precedes the number in Turkish, and the decimal
   * separator differs across the ten catalogs. The value itself is a `[0, 1]`
   * float from the contract.
   */
  const isStalePalette = isPaletteStale(analysis)

  const confidenceLabel = useMemo(() => {
    if (analysis?.status !== 'ready') return null
    return new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(analysis.confidence)
  }, [analysis, i18n.language])

  return (
    <section
      aria-labelledby="palette-advisor-title"
      data-testid="palette-advisor-panel"
      aria-busy={panelState === 'checking' || panelState === 'loading'}
      className="max-w-2xl"
    >
      {/*
        An `h1`, not an `h2`, because this panel IS the whole of `/palette`
        rather than one section among three the way `PremiumThemeSection` sits
        on `/settings`. Rendering a hardcoded English `<h1>Palette</h1>` on the
        page and this heading beneath it would have put an untranslated string
        on a surface whose every other word ships in ten catalogs, and said the
        same thing twice.
      */}
      <h1
        id="palette-advisor-title"
        className="text-4xl font-semibold text-white"
        data-testid="palette-advisor-title"
      >
        {t('commerce.premium.palette.sectionTitle')}
      </h1>

      <p
        className="mt-3 text-sm leading-relaxed text-neutral-200"
        data-testid="palette-advisor-intro"
      >
        {t('commerce.premium.palette.intro')}
      </p>

      {/*
        The kill-switch note precedes the controls it explains, and is the target
        of their `aria-describedby`, so a disabled control is never disabled
        without a reason.
      */}
      {view.showUnavailableNote && (
        <p
          id={UNAVAILABLE_HINT_ID}
          className="mt-4 text-sm text-neutral-300"
          data-testid="palette-advisor-unavailable"
        >
          {t('commerce.premium.palette.unavailable')}
        </p>
      )}

      {view.showConsent && (
        <ConsentBlock
          hasConsent={profile?.hasConsent === true}
          isBusy={busy !== null}
          isAnalysisEnabled={profile?.analysisEnabled !== false}
          showUnavailableNote={view.showUnavailableNote}
          confirmingErase={confirmingErase}
          onGrant={handleGrantConsent}
          onStartErase={() => setConfirmingErase(true)}
          onCancelErase={() => setConfirmingErase(false)}
          onConfirmErase={handleConfirmErase}
        />
      )}

      {view.showSources && (
        <SourceChoice
          isBusy={busy !== null}
          isAnalysisEnabled={profile?.analysisEnabled !== false}
          showUnavailableNote={view.showUnavailableNote}
          onAnalyzeWardrobe={handleAnalyzeWardrobe}
          onSelfieChosen={handleSelfieChosen}
        />
      )}

      <AnalysisStatus
        statusKey={currentStatusKey}
        failureReason={
          view.showSources && analysis?.status === 'failed'
            ? analysis.failureReason
            : null
        }
      />

      {view.showSources && analysis?.status === 'ready' && (
        <>
          <PaletteResult
            undertone={analysis.undertone}
            depth={analysis.depth}
            confidenceLabel={confidenceLabel}
            isStale={isStalePalette}
          />

          {lastDismissal && (
            <div
              className="mt-4 flex flex-wrap items-center gap-3"
              data-testid="palette-advisor-dismissed-notice"
            >
              <span role="status" className="text-sm text-neutral-200">
                {t('commerce.premium.palette.actions.dismissed')}
              </span>
              <button
                type="button"
                className="min-h-[44px] rounded-md border border-neutral-600 px-4 text-sm text-white"
                data-testid="palette-advisor-undo-dismiss"
                disabled={busy !== null}
                onClick={handleUndoDismiss}
              >
                {t('commerce.premium.palette.actions.undo')}
              </button>
            </div>
          )}

          <ul className="mt-6 space-y-4" data-testid="palette-advisor-recommendations">
            {recommendations.map((card) => (
              <RecommendationCard
                key={card.itemKey}
                card={card}
                isBusy={busy !== null}
                onSave={() => handleRecommendation(card, 'saved')}
                onDismiss={() => handleRecommendation(card, 'dismissed')}
                onUndoSave={() => handleRecommendation(card, null)}
                onSponsoredActivate={() => {
                  void handleSponsoredActivate(card)
                }}
                sponsoredError={
                  sponsoredErrorItemKey === card.itemKey
                    ? t('commerce.premium.palette.saveError')
                    : null
                }
              />
            ))}
          </ul>
        </>
      )}

      {view.showLocked && <LockedPanel isSignedOut={panelState === 'signed_out'} />}

      {error && (
        <p
          role="alert"
          className="mt-4 text-sm text-red-300"
          data-testid="palette-advisor-error"
        >
          {error}
        </p>
      )}
    </section>
  )
}
