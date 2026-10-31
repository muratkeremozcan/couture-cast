'use client'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { PreparedShareCard, ShareCardSource } from '@couture/api-client'
import { resolveSupportedLocale } from '@couture/api-client/contracts/http'
import { currentI18n } from '../../i18n'
import {
  authorizeShareCardFile,
  canShareCardFiles,
  captureShareCardShared,
  downloadShareCard,
  handOffShareCardFile,
  prepareShareCardFromWeb,
  shareCardCapabilitiesFromWeb,
  shareCardErrorKey,
  type WebShareResult,
} from '../../lib/share-cards'
import { webSessionIdentity } from '../../lib/web-session'
import { AccessibleModal } from './accessible-modal'

const subscribeIdentity = (callback: () => void) => {
  window.addEventListener('couture:session', callback)
  return () => window.removeEventListener('couture:session', callback)
}
const saveIsDisabled = (valid: boolean, loaded: string | null, presentation: string) =>
  !valid || loaded !== presentation
const saveButtonState = (changed: boolean, busy: boolean, unavailable: boolean) => ({
  disabled: !changed && unavailable,
  'aria-disabled': busy || unavailable || undefined,
})
const recoveryLabel = (changed: boolean) => (changed ? 'refresh' : 'retry')
const recoveryIsVisible = (action: string | null, changed: boolean) =>
  action !== null || changed
const buttonLabel = (busy: boolean) => (busy ? 'saving' : 'download')
/**
 * Story 6.9: a share handoff authorization lasts at most 60 s. Within it a tap hands the
 * already reauthorized File to `navigator.share` with no await before it, so the tap's
 * transient activation survives. Accepted revocation window: a member whose share access
 * is revoked on the server can still hand off these same previewed bytes until the
 * authorization expires, at most 60 s after its reauthorization.
 */
export const SHARE_AUTHORIZATION_TTL_MS = 60_000
type ShareAuthorization = {
  member: string | null
  presentation: string
  digest: string
  file: File
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}
function revokeAuthorization(held: { current: ShareAuthorization | null }) {
  if (held.current) clearTimeout(held.current.timer)
  held.current = null
}
type ShareFeedback = 'sentToApp' | 'shareClosed' | 'shareTapAgain'
type FocusTarget = 'share' | 'download' | 'recovery'
const shareFeedback = (result: WebShareResult): ShareFeedback | null =>
  result.outcome === 'handed_off'
    ? 'sentToApp'
    : result.outcome === 'dismissed'
      ? 'shareClosed'
      : result.code === 'activation_expired'
        ? 'shareTapAgain'
        : null
const busyAttribute = (busy: boolean) => busy || undefined
const shareIsVisible = (
  capability: { member: string; on: boolean } | null,
  member: string | null
) => capability !== null && capability.on && capability.member === member
function ShareCardShareButton({
  visible,
  buttonRef,
  state,
  sharing,
  onShare,
}: {
  visible: boolean
  buttonRef: React.RefObject<HTMLButtonElement | null>
  state: ReturnType<typeof saveButtonState>
  sharing: boolean
  onShare: () => void
}) {
  const { t } = useTranslation(undefined, { i18n: currentI18n() })
  if (!visible) return null
  return (
    <button
      ref={buttonRef}
      type="button"
      className="min-h-[44px] rounded border border-[#292724] px-5 text-[#292724] disabled:opacity-50 aria-disabled:opacity-50 dark:border-zinc-100 dark:text-zinc-100"
      data-testid="share-card-share"
      {...state}
      aria-busy={busyAttribute(sharing)}
      onClick={onShare}
    >
      {t('shareCard.share')}
    </button>
  )
}
/**
 * The visible feedback slot always holds one line (text-sm: 20 px), so single-line copy
 * appearing or clearing never changes the dialog's height. The centered dialog would
 * otherwise move up by half the line and its spacing. Visible copy is for sighted
 * members; the dialog's status region announces it once, so the slot stays hidden from
 * assistive technology whether it is empty or filled.
 */
function ShareCardShareNote({ note }: { note: ShareFeedback | null }) {
  const { t } = useTranslation(undefined, { i18n: currentI18n() })
  return (
    <p
      className="mt-2 min-h-5 text-sm text-[#292724] dark:text-zinc-100"
      data-testid="share-card-feedback"
      aria-hidden="true"
    >
      {note ? t(`shareCard.${note}`) : null}
    </p>
  )
}
function ShareCardOpenButton({
  onOpen,
  register,
}: {
  onOpen: (opener: HTMLButtonElement) => void
  register?: (opener: HTMLButtonElement | null) => void
}) {
  const { t } = useTranslation(undefined, { i18n: currentI18n() })
  return (
    <button
      ref={register}
      type="button"
      data-testid="share-card-open"
      onClick={(event) => onOpen(event.currentTarget)}
      className="min-h-[44px] rounded border border-[#B28D46] px-4 text-sm text-[#292724]"
    >
      {t('shareCard.title')}
    </button>
  )
}
/**
 * Lets a list that may unmount its cards (the community feed hides them while access
 * is re-verified) keep one share dialog and its composition above those cards.
 */
export type ShareCardHost = {
  open: (postId: string, scope: string, opener: HTMLElement) => void
  register: (postId: string, scope: string, opener: HTMLElement | null) => void
}
export const ShareCardHostContext = createContext<ShareCardHost | null>(null)
export function CommunityShareCardControl({
  postId,
  scope,
}: {
  postId: string
  scope: string
}) {
  const host = useContext(ShareCardHostContext)
  if (!host) return <ShareCardControl source={{ kind: 'community_post', postId }} />
  return (
    <ShareCardOpenButton
      onOpen={(opener) => host.open(postId, scope, opener)}
      register={(opener) => host.register(postId, scope, opener)}
    />
  )
}
export function ShareCardControl({ source }: { source: ShareCardSource }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <ShareCardOpenButton
        onOpen={(element) => {
          opener.current = element
          setOpen(true)
        }}
      />
      <ShareCardDialog
        source={source}
        open={open}
        onClose={() => setOpen(false)}
        opener={opener}
      />
    </>
  )
}
export function ShareCardDialog({
  source,
  open,
  onClose,
  opener,
}: {
  source: ShareCardSource
  open: boolean
  onClose: () => void
  opener: React.RefObject<HTMLElement | null>
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: currentI18n() })
  const member = useSyncExternalStore(subscribeIdentity, webSessionIdentity, () => null)
  const locale = resolveSupportedLocale(i18n.language) ?? 'en-US'
  const [watermark, setWatermark] = useState(true)
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
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [changed, setChanged] = useState(false)
  const [recoveryAction, setRecoveryAction] = useState<'prepare' | 'save' | null>(null)
  const [capability, setCapability] = useState<{ member: string; on: boolean } | null>(
    null
  )
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState<ShareFeedback | null>(null)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const authorization = useRef<ShareAuthorization | null>(null)
  const shareRef = useRef<HTMLButtonElement>(null)
  const recoveryRef = useRef<HTMLButtonElement>(null)
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const saving = useRef(false)
  // Bumped on every identity change, so a share attempt can tell a sign-out or member
  // switch (which suppresses its event) from a close or composition change.
  const identityEpoch = useRef(0)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const sourceIdentity = JSON.stringify(source)
  const key = JSON.stringify({ source, locale, watermark })
  const current =
    preview?.member === member && preview.sourceIdentity === sourceIdentity
      ? preview
      : null
  const valid = current?.key === key && !changed
  const presentation = `${key}:${current?.renderId}:${presentationEpoch}`
  const saveUnavailable = saveIsDisabled(valid, loaded, presentation)
  const latest = useRef({ member, key, open })
  latest.current = { member, key, open }
  const downloadBusy = busy && !sharing
  const clearAuthorization = () => revokeAuthorization(authorization)
  useLayoutEffect(() => {
    if (!focusTarget) return
    const target = { share: shareRef, download: saveRef, recovery: recoveryRef }[
      focusTarget
    ]
    target.current?.focus({ preventScroll: true })
    setFocusTarget(null)
  }, [focusTarget])
  // Capability state belongs to the member it was asked for: an identity change
  // clears it, and a late answer for a previous member is dropped.
  useEffect(() => {
    if (!open || member === null || capability?.member === member) return
    if (!canShareCardFiles()) return
    const abort = new AbortController()
    void shareCardCapabilitiesFromWeb(abort.signal).then(({ nativeShare }) => {
      if (!abort.signal.aborted && latest.current.member === member)
        setCapability({ member, on: nativeShare })
    })
    return () => abort.abort()
  }, [open, member, capability])
  // A composition change ends the handoff authorization.
  useEffect(() => () => revokeAuthorization(authorization), [key])
  useLayoutEffect(() => {
    if (recoveryAction !== 'prepare' || busy || error || saveUnavailable) return
    // Keep recovery focus until the replacement image enables Save, then move
    // focus before removing the control that currently owns it.
    saveRef.current?.focus({ preventScroll: true })
    setRecoveryAction(null)
  }, [recoveryAction, busy, error, saveUnavailable])
  useEffect(() => {
    setPreview(null)
    setLoaded(null)
    setChanged(false)
    setRecoveryAction(null)
    setCapability(null)
    setShareNote(null)
    revokeAuthorization(authorization)
    identityEpoch.current++
    controller.current?.abort()
    sequence.current++
  }, [member])
  useEffect(() => {
    if (!open) return
    const generation = ++sequence.current
    const abort = new AbortController()
    controller.current = abort
    if (valid) return () => abort.abort()
    setBusy(true)
    setError(null)
    setMessage('preparing')
    void prepareShareCardFromWeb(
      { source, locale, watermark, purpose: 'preview' },
      abort.signal
    )
      .then((card) => {
        if (abort.signal.aborted || generation !== sequence.current) return
        setPreview({ card, key, member, sourceIdentity, renderId: generation })
        setLoaded(null)
        setChanged(false)
        setMessage(null)
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted && generation === sequence.current) {
          setError(shareCardErrorKey(failure))
          setRecoveryAction('prepare')
          setMessage(null)
        }
      })
      .finally(() => {
        // An unmount aborts without bumping the sequence; a settled request
        // must not set state on an unmounted dialog.
        if (!abort.signal.aborted && generation === sequence.current) setBusy(false)
      })
    return () => {
      abort.abort()
    }
    // The stable composition key owns source, locale and watermark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, member, refresh])
  useEffect(() => {
    if (!open) {
      controller.current?.abort()
      sequence.current++
      revokeAuthorization(authorization)
      setBusy(false)
      setSharing(false)
      setMessage(null)
      setShareNote(null)
      setError(null)
      setRecoveryAction(null)
    }
  }, [open])
  useEffect(
    () => () => {
      latest.current.open = false
      sequence.current++
      controller.current?.abort()
      revokeAuthorization(authorization)
    },
    []
  )
  const close = () => {
    controller.current?.abort()
    sequence.current++
    clearAuthorization()
    setBusy(false)
    setSharing(false)
    setMessage(null)
    setShareNote(null)
    setError(null)
    setRecoveryAction(null)
    setLoaded(null)
    setPresentationEpoch((value) => value + 1)
    onClose()
  }
  const save = async () => {
    if (!current || !valid || loaded !== presentation || saving.current || busy) return
    saving.current = true
    setBusy(true)
    setError(null)
    setShareNote(null)
    setMessage('saving')
    const abort = new AbortController()
    controller.current = abort
    const original = { member, key, generation: sequence.current }
    const stillCurrent = () =>
      !abort.signal.aborted &&
      latest.current.open &&
      latest.current.key === original.key &&
      latest.current.member === original.member &&
      sequence.current === original.generation
    try {
      const authorized = await prepareShareCardFromWeb(
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
        setRecoveryAction('prepare')
        setError('previewChanged')
        setMessage(null)
        return
      }
      await downloadShareCard(current.card, abort.signal)
      if (stillCurrent()) {
        setMessage('downloadStarted')
        saveRef.current?.focus({ preventScroll: true })
        setRecoveryAction(null)
      }
    } catch (failure) {
      if (stillCurrent()) {
        const code = shareCardErrorKey(failure)
        setError(code)
        setRecoveryAction(code === 'previewChanged' ? 'prepare' : 'save')
        setMessage(null)
        if (code === 'previewChanged') setChanged(true)
      }
    } finally {
      saving.current = false
      if (stillCurrent()) setBusy(false)
    }
  }
  /**
   * One Share activation that passes the duplicate guard is one attempt, and every
   * attempt captures exactly one share_card_shared. Only an identity change or sign-out
   * suppresses it. A close or composition change before the handoff settles the
   * attempt as failed/none without feedback; after the handoff the attempt keeps the
   * outcome the browser reports, again without feedback.
   */
  const share = () => {
    if (!current || !valid || loaded !== presentation || saving.current || busy) return
    const activatedAt = performance.now()
    const digest = current.card.sha256
    const held = authorization.current
    // The timer clears an expired authorization; the deadline check also covers a
    // timer that a background tab throttled past it.
    if (
      held &&
      (held.member !== member ||
        held.presentation !== presentation ||
        held.digest !== digest ||
        Date.now() >= held.expiresAt)
    )
      clearAuthorization()
    // Nothing may await before navigator.share on an authorized tap.
    const handoff = authorization.current
      ? handOffShareCardFile(authorization.current.file)
      : null
    saving.current = true
    setBusy(true)
    setSharing(true)
    setError(null)
    setShareNote(null)
    setRecoveryAction(null)
    setMessage('sharing')
    const abort = new AbortController()
    controller.current = abort
    const original = {
      member,
      key,
      presentation,
      generation: sequence.current,
      identity: identityEpoch.current,
    }
    const stillCurrent = () =>
      !abort.signal.aborted &&
      latest.current.open &&
      latest.current.key === original.key &&
      latest.current.member === original.member &&
      sequence.current === original.generation
    // The live session read also covers a sign-out that unmounts the dialog before it
    // re-renders with the new identity.
    const identityChanged = () =>
      webSessionIdentity() !== original.member ||
      identityEpoch.current !== original.identity
    const release = () => {
      saving.current = false
      setSharing(false)
    }
    const shareFailure: WebShareResult = {
      outcome: 'failed',
      target: 'none',
      code: 'share_error',
    }
    const settle = (result: WebShareResult) => {
      release()
      if (identityChanged()) return
      if (stillCurrent()) {
        setBusy(false)
        const note = shareFeedback(result)
        if (note) {
          setMessage(note)
          setShareNote(note)
          setFocusTarget('share')
        } else {
          clearAuthorization()
          setMessage(null)
          setError('shareFailed')
          setFocusTarget('download')
        }
      }
      captureShareCardShared(result, activatedAt)
    }
    if (handoff) {
      void handoff.then(settle)
      return
    }
    void (async () => {
      let file: File
      try {
        file = await authorizeShareCardFile(
          { source, locale, watermark, expectedSha256: digest },
          abort.signal
        )
      } catch (failure) {
        if (stillCurrent() && shareCardErrorKey(failure) === 'previewChanged') {
          // The 6.8 stale path: keep the old composition, disable Download and Share
          // until a fresh preview loads, and move focus to Refresh.
          release()
          setBusy(false)
          setChanged(true)
          setRecoveryAction('prepare')
          setError('previewChanged')
          setMessage(null)
          setFocusTarget('recovery')
          captureShareCardShared({ outcome: 'failed', target: 'none' }, activatedAt)
          return
        }
        settle(shareFailure)
        return
      }
      if (!stillCurrent()) {
        settle(shareFailure)
        return
      }
      clearAuthorization()
      authorization.current = {
        member,
        presentation: original.presentation,
        digest,
        file,
        expiresAt: Date.now() + SHARE_AUTHORIZATION_TTL_MS,
        timer: setTimeout(clearAuthorization, SHARE_AUTHORIZATION_TTL_MS),
      }
      // The activation may have expired during the reauthorization; NotAllowedError
      // then keeps this authorization and asks for one more tap.
      settle(await handOffShareCardFile(file))
    })()
  }
  return (
    <AccessibleModal
      isOpen={open}
      onClose={close}
      titleId="share-card-title"
      title={t('shareCard.title')}
      closeLabel={t('shareCard.close')}
      invokingElementRef={opener}
      initialFocusRef={titleRef}
      fallbackFocusSelector={`[data-share-card-focus-fallback="${source.kind === 'outfit' ? 'hero' : 'community'}"]`}
      ariaLiveMessage={message ? t(`shareCard.${message}`) : null}
      errorMessage={error ? t(`shareCard.${error}`) : null}
    >
      <h3 ref={titleRef} tabIndex={-1} className="sr-only">
        {t('shareCard.title')}
      </h3>
      {source.kind === 'community_post' && (
        <p className="my-3 text-sm">{t('shareCard.photoPrivacyHelp')}</p>
      )}
      <label className="my-3 flex min-h-[44px] items-center gap-3">
        <input
          type="checkbox"
          className="!h-5 !min-h-0 !w-5 !min-w-0 shrink-0 accent-[#B28D46]"
          checked={watermark}
          disabled={saving.current}
          onChange={(event) => {
            setWatermark(event.target.checked)
            setShareNote(null)
            setChanged(false)
            setRecoveryAction(null)
            setLoaded(null)
          }}
        />
        {t('shareCard.watermark')}
      </label>
      {current && (
        // The preview is the dialog's one flexible height. At rest everything else, with
        // the photo privacy help, totals 337 px (overlay inset, padding, header, help,
        // watermark, feedback line, one action row); the 22rem (352 px) cap keeps the
        // dialog unscrolled at desktop sizes as short as 1280x720.
        // The approved data URI needs a new native load event for every presentation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={presentation}
          src={`data:image/png;base64,${current.card.pngBase64}`}
          width={1080}
          height={1350}
          alt={current.card.accessibilityLabel}
          data-testid="share-card-preview"
          data-loaded={saveUnavailable ? 'false' : 'true'}
          data-sha256={current.card.sha256}
          className="mx-auto h-auto max-h-[min(55dvh,calc(100dvh-22rem))] w-auto max-w-full"
          onLoad={() => setLoaded(presentation)}
          onError={() => {
            setLoaded(null)
            setError('render')
            setRecoveryAction('prepare')
          }}
        />
      )}
      <ShareCardShareNote note={shareNote} />
      {/*
       * Two action groups. The boxed primary actions fit one row in every locale at
       * 390 px. Recovery and Cancel are padded text buttons; the group's -ml-3 cancels
       * their px-3 so, whenever the group starts a line, the first label's glyphs start
       * on Download's left edge. Below sm the groups stack as two rows. From sm the
       * dialog is 464 px wide and they share one row (Download, Share, Cancel fit in
       * every locale), so the dialog stays one action row shorter. There gap-x-6 less
       * that margin leaves 24 px between Share's box and the first label, as between two
       * labels. A group that does not fit, such as one with a long Refresh label, wraps
       * whole onto the next line.
       */}
      <div className="mt-2 flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:flex-wrap">
        <div className="flex flex-wrap gap-3" data-testid="share-card-primary-actions">
          <button
            ref={saveRef}
            type="button"
            className="min-h-[44px] rounded bg-[#292724] px-5 text-white disabled:opacity-50 aria-disabled:opacity-50"
            data-testid="share-card-save"
            {...saveButtonState(changed, busy, saveUnavailable)}
            aria-busy={busyAttribute(downloadBusy)}
            onClick={() => void save()}
          >
            {t(`shareCard.${buttonLabel(downloadBusy)}`)}
          </button>
          <ShareCardShareButton
            visible={shareIsVisible(capability, member)}
            buttonRef={shareRef}
            state={saveButtonState(changed, busy, saveUnavailable)}
            sharing={sharing}
            onShare={share}
          />
        </div>
        <div className="-ml-3 flex flex-wrap" data-testid="share-card-secondary-actions">
          {recoveryIsVisible(recoveryAction, changed) && (
            <button
              ref={recoveryRef}
              data-testid="share-card-recovery"
              className="min-h-[44px] px-3 aria-disabled:opacity-50"
              type="button"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => {
                if (busy) return
                if (recoveryAction === 'save' && valid && loaded === presentation) {
                  void save()
                } else {
                  setChanged(true)
                  setRefresh((n) => n + 1)
                }
              }}
            >
              {t(`shareCard.${recoveryLabel(changed)}`)}
            </button>
          )}
          <button
            type="button"
            className="min-h-[44px] px-3"
            data-testid="share-card-cancel"
            onClick={close}
          >
            {t('shareCard.cancel')}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
