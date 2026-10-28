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
  downloadShareCard,
  prepareShareCardFromWeb,
  shareCardErrorKey,
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
  open: (postId: string, opener: HTMLElement) => void
  register: (postId: string, opener: HTMLElement | null) => void
}
export const ShareCardHostContext = createContext<ShareCardHost | null>(null)
export function CommunityShareCardControl({ postId }: { postId: string }) {
  const host = useContext(ShareCardHostContext)
  if (!host) return <ShareCardControl source={{ kind: 'community_post', postId }} />
  return (
    <ShareCardOpenButton
      onOpen={(opener) => host.open(postId, opener)}
      register={(opener) => host.register(postId, opener)}
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
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const saving = useRef(false)
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
        if (generation === sequence.current) setBusy(false)
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
      setBusy(false)
      setMessage(null)
      setError(null)
      setRecoveryAction(null)
    }
  }, [open])
  useEffect(
    () => () => {
      latest.current.open = false
      sequence.current++
      controller.current?.abort()
    },
    []
  )
  const close = () => {
    controller.current?.abort()
    sequence.current++
    setBusy(false)
    setMessage(null)
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
            setChanged(false)
            setRecoveryAction(null)
            setLoaded(null)
          }}
        />
        {t('shareCard.watermark')}
      </label>
      {current && (
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
          className="mx-auto h-auto max-h-[55dvh] w-auto max-w-full"
          onLoad={() => setLoaded(presentation)}
          onError={() => {
            setLoaded(null)
            setError('render')
            setRecoveryAction('prepare')
          }}
        />
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          ref={saveRef}
          type="button"
          className="min-h-[44px] rounded bg-[#292724] px-5 text-white disabled:opacity-50"
          data-testid="share-card-save"
          {...saveButtonState(changed, busy, saveUnavailable)}
          aria-busy={busy || undefined}
          onClick={() => void save()}
        >
          {t(`shareCard.${buttonLabel(busy)}`)}
        </button>
        {recoveryIsVisible(recoveryAction, changed) && (
          <button
            data-testid="share-card-recovery"
            className="min-h-[44px] px-3"
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
        <button type="button" className="min-h-[44px] px-3" onClick={close}>
          {t('shareCard.cancel')}
        </button>
      </div>
    </AccessibleModal>
  )
}
