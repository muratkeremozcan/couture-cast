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
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  ResponseError,
  type PreparedShareCard,
  type ShareCardSource,
} from '@couture/api-client'
import { resolveSupportedLocale } from '@couture/api-client/contracts/http'
import { EdgeToEdgeModal, useModalInsets } from './edge-to-edge-modal'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { focusShareCardElement } from '@/src/lib/share-card-focus'
import { traceShareCardOpener } from '@/src/lib/share-card-presentation-trace'
import {
  mobileApplicationUserId,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { prepareShareCardFromMobile } from '@/src/lib/share-cards'
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
  const recoveryTarget = useRef<View>(null)
  const cancelTarget = useRef<View>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const saveGuard = useRef(false)
  const [saving, setSaving] = useState(false)
  const activeSave = useRef<SaveOwner | null>(null)
  const insets = useModalInsets()
  const systemBarsReady = useShareCardStatusBar(
    open && source !== null,
    modalSystemBarsAvailable()
  )
  const available = nativeShareCardSaveAvailable()
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
  useEffect(() => {
    abortRef.current?.abort()
    generation.current++
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
        <ScrollView contentContainerStyle={styles.content}>
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
          <CardPreview
            key={presentation}
            current={current}
            loaded={valid && loaded === presentation}
            onLoad={() => setLoaded(presentation)}
            onError={() => {
              setLoaded(null)
              setError('render')
            }}
          />
          <ComposerFeedback
            onFocusResult={(status) => {
              const target =
                status === 'saved'
                  ? saveTarget.current
                  : status === 'finishingSave'
                    ? cancelTarget.current
                    : recoveryTarget.current
              const captured = generation.current
              focusShareCardElement(
                safeFindNodeHandle(target),
                () =>
                  latest.current.open &&
                  latest.current.member === member &&
                  latest.current.key === key &&
                  generation.current === captured
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
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled,
            }}
            disabled={disabled}
            onPress={() => void save()}
            style={styles.button}
            ref={saveTarget}
            testID="share-card-save"
          >
            <Text style={styles.buttonText}>{t('shareCard.save')}</Text>
          </Pressable>
          <RecoveryActions
            target={recoveryTarget}
            permission={permission}
            error={error}
            changed={changed}
            disabled={busy || pendingNative}
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
            style={styles.button}
            onPress={close}
            ref={cancelTarget}
            testID="share-card-cancel"
          >
            <Text style={styles.buttonText}>{t('shareCard.cancel')}</Text>
          </Pressable>
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
  loaded,
  onLoad,
  onError,
}: {
  current: PreparedPreview | null
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
      style={styles.preview}
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
    if (!['preparing', 'saving', 'nativeSaveUnavailable'].includes(key))
      onFocusResult(key)
    if (Platform.OS !== 'ios') return
    AccessibilityInfo.announceForAccessibilityWithOptions(announcement, {
      queue: available && !error,
    })
  }, [visible, scope, available, error, pending, message, t, onFocusResult])
  return (
    <>
      {(pending || message) && (
        <Text
          testID="share-card-feedback"
          accessibilityLiveRegion="polite"
          style={styles.text}
        >
          {pending ? t('shareCard.finishingSave') : t(`shareCard.${message}`)}
        </Text>
      )}
      {(!available || error) && (
        <Text
          testID="share-card-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
        >
          {t(`shareCard.${available ? error : 'nativeSaveUnavailable'}`)}
        </Text>
      )}
    </>
  )
}
function RecoveryActions({
  target,
  permission,
  error,
  changed,
  disabled,
  t,
  retry,
}: {
  target: React.Ref<View>
  permission: 'denied' | 'permanent' | null
  error: string | null
  changed: boolean
  disabled: boolean
  t: Translation
  retry: () => void
}) {
  if (permission === 'permanent')
    return (
      <Pressable
        ref={target}
        testID="share-card-settings"
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          void Linking.openSettings()
        }}
      >
        <Text style={styles.buttonText}>{t('shareCard.openSettings')}</Text>
      </Pressable>
    )
  if (!error && !changed) return null
  return (
    <Pressable
      ref={target}
      testID={changed ? 'share-card-refresh' : 'share-card-retry'}
      accessibilityRole="button"
      style={styles.button}
      disabled={disabled}
      onPress={retry}
    >
      <Text style={styles.buttonText}>
        {t(`shareCard.${changed ? 'refresh' : 'retry'}`)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#F7F3E8' },
  content: { paddingHorizontal: 24, gap: 16 },
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
  preview: { width: '100%', aspectRatio: 1080 / 1350 },
  error: { color: '#7A1F2D', fontSize: 16 },
  button: {
    minHeight: 48,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B28D46',
    borderRadius: 8,
  },
  buttonText: { color: '#292724', fontSize: 16, textAlign: 'center' },
})
