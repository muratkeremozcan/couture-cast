// Story 4.4 Task 6 owner: shared silhouette editor (sliders + "My Form" photo
// pipeline). Reused as-is by both the standalone settings screen
// (wardrobe-silhouette.tsx) and the onboarding silhouette step
// (wardrobe-onboarding.tsx) so the two surfaces never diverge.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import {
  uploadGarmentBytes,
  type SilhouetteMode,
  type SilhouetteProfileContract,
  type SilhouettePhotoFailureReason,
} from '@couture/api-client/contracts/http'

import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { sha256Hex } from '@/src/lib/expo-native-helpers'
import { waitForPoll } from '@/src/lib/native-utils'
import {
  commitSilhouettePhotoFromMobile,
  createSilhouetteUploadUrlFromMobile,
  deleteSilhouettePhotoFromMobile,
  getSilhouetteProfileFromMobile,
  resolveOwnerUserId,
  silhouetteETag,
  updateSilhouetteSlidersFromMobile,
} from '@/src/lib/wardrobe'

const SLIDER_MIN = 0
const SLIDER_MAX = 100
const SLIDER_STEP = 5
const DEFAULT_POLL_INTERVAL_MS = 2_000
const POLL_MAX_ATTEMPTS = 15
const GUARDIAN_CONSENT_CODE = 'GUARDIAN_CONSENT_REQUIRED'

type MyFormPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed'

function failureReasonKey(reason: SilhouettePhotoFailureReason | null): string {
  switch (reason) {
    case 'contrast':
      return 'wardrobe.silhouette.errors.contrast'
    case 'privacy_violation':
      return 'wardrobe.silhouette.errors.privacy_violation'
    case 'timeout':
      return 'wardrobe.silhouette.errors.timeout'
    case 'storage_error':
      return 'wardrobe.silhouette.errors.storage_error'
    default:
      return 'wardrobe.silhouette.errors.storage_error'
  }
}

export interface SilhouetteEditorProps {
  accessToken: string
  /** Fires on every successful profile read/write, for a host screen that cares. */
  onProfileChange?: (profile: SilhouetteProfileContract) => void
  /** Test-only override for the My Form processing poll cadence. */
  pollIntervalMs?: number
}

interface SliderRowProps {
  label: string
  value: number
  onDecrement: () => void
  onIncrement: () => void
  disabled: boolean
  testIdPrefix: string
}

function SliderRow({
  label,
  value,
  onDecrement,
  onIncrement,
  disabled,
  testIdPrefix,
}: SliderRowProps) {
  const atMin = value <= SLIDER_MIN
  const atMax = value >= SLIDER_MAX
  return (
    <View style={styles.sliderRow} testID={`${testIdPrefix}-row`}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <View
        style={styles.sliderControl}
        accessible={true}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: SLIDER_MIN, max: SLIDER_MAX, now: value }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} -`}
          accessibilityState={{ disabled: disabled || atMin }}
          disabled={disabled || atMin}
          testID={`${testIdPrefix}-decrement`}
          style={[styles.stepperButton, (disabled || atMin) && styles.stepperDisabled]}
          onPress={onDecrement}
        >
          <Text style={styles.stepperText}>−</Text>
        </Pressable>
        <Text style={styles.sliderValue} testID={`${testIdPrefix}-value`}>
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
          accessibilityState={{ disabled: disabled || atMax }}
          disabled={disabled || atMax}
          testID={`${testIdPrefix}-increment`}
          style={[styles.stepperButton, (disabled || atMax) && styles.stepperDisabled]}
          onPress={onIncrement}
        >
          <Text style={styles.stepperText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// eslint-disable-next-line complexity
export function SilhouetteEditor({
  accessToken,
  onProfileChange,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: SilhouetteEditorProps) {
  const { t } = useTranslation()
  const { announce } = useAccessibilityAnnouncer()

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<SilhouetteProfileContract | null>(null)
  const [activeTab, setActiveTab] = useState<SilhouetteMode>('default_mannequin')

  const [heightSlider, setHeightSlider] = useState(SLIDER_MAX / 2)
  const [buildSlider, setBuildSlider] = useState(SLIDER_MAX / 2)
  const [isSavingSliders, setIsSavingSliders] = useState(false)
  const [sliderError, setSliderError] = useState<string | null>(null)

  const [guidanceConfirmed, setGuidanceConfirmed] = useState(false)
  const [myFormPhase, setMyFormPhase] = useState<MyFormPhase>('idle')
  const [myFormError, setMyFormError] = useState<string | null>(null)
  const [myFormErrorKey, setMyFormErrorKey] = useState<string | null>(null)

  const revisionRef = useRef(0)
  const userIdRef = useRef('')
  const attemptIdempotencyKeyRef = useRef<string | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const lastChangedFieldRef = useRef<'height' | 'build'>('height')

  const applyProfile = useCallback(
    (next: SilhouetteProfileContract) => {
      setProfile(next)
      revisionRef.current = next.revision
      setHeightSlider(next.heightSlider ?? SLIDER_MAX / 2)
      setBuildSlider(next.buildSlider ?? SLIDER_MAX / 2)
      setActiveTab(next.mode)
      if (next.myForm) {
        if (next.myForm.status === 'ready') setMyFormPhase('ready')
        else if (next.myForm.status === 'failed') {
          setMyFormPhase('failed')
          setMyFormErrorKey(failureReasonKey(next.myForm.failureReason))
        } else if (
          next.myForm.status === 'processing' ||
          next.myForm.status === 'bytes_uploaded'
        ) {
          setMyFormPhase('processing')
        }
      } else {
        setMyFormPhase('idle')
      }
      onProfileChange?.(next)
    },
    [onProfileChange]
  )

  const pollMyForm = useCallback(() => {
    if (pollAbortRef.current) return
    const controller = new AbortController()
    pollAbortRef.current = controller
    void (async () => {
      try {
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
          await waitForPoll(pollIntervalMs, controller.signal)
          const next = await getSilhouetteProfileFromMobile(accessToken)
          if (controller.signal.aborted) return
          applyProfile(next)
          if (next.myForm?.status === 'ready') {
            announce('feedback', t('wardrobe.silhouette.ready'))
            return
          }
          if (next.myForm?.status === 'failed') {
            announce(
              'error',
              t(failureReasonKey(next.myForm.failureReason ?? 'storage_error'))
            )
            return
          }
        }
      } catch {
        // Aborted (component unmounted or a new attempt started) or a transient
        // network failure; either way the server-side job remains the source of
        // truth and the next explicit load will pick up its terminal state.
      } finally {
        if (pollAbortRef.current === controller) {
          pollAbortRef.current = null
        }
      }
    })()
  }, [accessToken, announce, applyProfile, pollIntervalMs, t])

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      userIdRef.current = resolveOwnerUserId(accessToken)
      const next = await getSilhouetteProfileFromMobile(accessToken)
      applyProfile(next)
      // A fresh mount (e.g. reopening this screen after the app was closed
      // mid-processing) must resume polling itself; runMyFormUpload only
      // starts it for an upload that happened in *this* mount.
      if (
        next.myForm?.status === 'processing' ||
        next.myForm?.status === 'bytes_uploaded'
      ) {
        pollMyForm()
      }
    } catch (error) {
      setLoadError(
        error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
          ? t('wardrobe.error.consent_required')
          : error instanceof Error
            ? error.message
            : t('wardrobe.silhouette.errors.storage_error')
      )
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, applyProfile, pollMyForm, t])

  useEffect(() => {
    void load()
    return () => pollAbortRef.current?.abort()
  }, [load])

  const saveSliders = useCallback(
    async (nextHeight: number, nextBuild: number, changedField: 'height' | 'build') => {
      lastChangedFieldRef.current = changedField
      setIsSavingSliders(true)
      setSliderError(null)
      try {
        const next = await updateSilhouetteSlidersFromMobile(
          accessToken,
          { heightSlider: nextHeight, buildSlider: nextBuild },
          silhouetteETag(userIdRef.current, revisionRef.current)
        )
        applyProfile(next)
        const changedLabel = t(
          changedField === 'height'
            ? 'wardrobe.silhouette.height_slider_label'
            : 'wardrobe.silhouette.build_slider_label'
        )
        const changedValue =
          changedField === 'height' ? next.heightSlider : next.buildSlider
        announce('feedback', `${changedLabel}: ${changedValue}`)
      } catch (error) {
        const message =
          error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
            ? t('wardrobe.error.consent_required')
            : error instanceof Error
              ? error.message
              : t('wardrobe.onboarding.errors.save_failed')
        setSliderError(message)
        announce('error', message)
      } finally {
        setIsSavingSliders(false)
      }
    },
    [accessToken, announce, applyProfile, t]
  )

  const adjustHeight = (direction: 1 | -1) => {
    const next = Math.min(
      SLIDER_MAX,
      Math.max(SLIDER_MIN, heightSlider + direction * SLIDER_STEP)
    )
    setHeightSlider(next)
    void saveSliders(next, buildSlider, 'height')
  }

  const adjustBuild = (direction: 1 | -1) => {
    const next = Math.min(
      SLIDER_MAX,
      Math.max(SLIDER_MIN, buildSlider + direction * SLIDER_STEP)
    )
    setBuildSlider(next)
    void saveSliders(heightSlider, next, 'build')
  }

  const runMyFormUpload = async (asset: ImagePicker.ImagePickerAsset) => {
    setMyFormPhase('uploading')
    setMyFormError(null)
    setMyFormErrorKey(null)
    attemptIdempotencyKeyRef.current ??= Crypto.randomUUID()
    const idempotencyKey = attemptIdempotencyKeyRef.current

    try {
      const maxDimension = Math.max(asset.width, asset.height)
      const scale = Math.min(1, 4096 / maxDimension)
      // Always re-encode, even when scale is 1 (no resize needed): the source
      // asset can be a JPEG or WebP (camera/library both hand back whatever
      // format the OS captured), and the allocation/upload/commit calls below
      // unconditionally declare `mimeType: 'image/png'`. Skipping this step
      // for an already-small photo previously uploaded the original bytes
      // under a false mimeType.
      const prepared = await manipulateAsync(
        asset.uri,
        [
          {
            resize: {
              width: Math.round(asset.width * scale),
              height: Math.round(asset.height * scale),
            },
          },
        ],
        { compress: 0.92, format: SaveFormat.PNG }
      )

      const file = new File(prepared.uri)
      const bytes = await file.bytes()
      const sha256 = await sha256Hex(bytes)

      const allocation = await createSilhouetteUploadUrlFromMobile(
        accessToken,
        {
          fileSizeBytes: bytes.byteLength,
          mimeType: 'image/png',
          sha256,
          widthPx: prepared.width,
          heightPx: prepared.height,
        },
        idempotencyKey
      )
      await uploadGarmentBytes({
        uploadUrl: allocation.uploadUrl,
        uploadToken: allocation.uploadToken,
        bearerToken: accessToken,
        mimeType: 'image/png',
        body: bytes.buffer,
      })
      const committed = await commitSilhouettePhotoFromMobile(
        accessToken,
        { uploadSessionId: allocation.uploadSessionId, confirmsBasewearGuidance: true },
        idempotencyKey
      )
      attemptIdempotencyKeyRef.current = null
      applyProfile(committed)
      setMyFormPhase('processing')
      announce('feedback', t('wardrobe.silhouette.processing'))
      pollMyForm()
    } catch (error) {
      const message =
        error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
          ? t('wardrobe.error.consent_required')
          : error instanceof Error
            ? error.message
            : t('wardrobe.silhouette.errors.storage_error')
      setMyFormPhase('failed')
      setMyFormError(message)
      announce('error', message)
    }
  }

  const openMyFormCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      setMyFormError(t('wardrobe.permission.camera_denied'))
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      void runMyFormUpload(result.assets[0])
    }
  }

  const openMyFormLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setMyFormError(t('wardrobe.permission.library_denied'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      void runMyFormUpload(result.assets[0])
    }
  }

  const removeMyForm = async () => {
    try {
      const next = await deleteSilhouettePhotoFromMobile(
        accessToken,
        silhouetteETag(userIdRef.current, revisionRef.current)
      )
      applyProfile(next)
      setMyFormPhase('idle')
      setGuidanceConfirmed(false)
      announce('feedback', t('wardrobe.silhouette.mode_default'))
    } catch (error) {
      const message =
        error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
          ? t('wardrobe.error.consent_required')
          : error instanceof Error
            ? error.message
            : t('wardrobe.silhouette.errors.storage_error')
      setMyFormError(message)
      announce('error', message)
    }
  }

  const retryMyForm = () => {
    // Retry sends the user back to source selection, not back to the exact
    // failed request — a photo picked from here on is a new logical attempt
    // and must get a fresh idempotency key. Reusing the failed attempt's key
    // here previously risked a spurious 409 IDEMPOTENCY_KEY_REUSED once the
    // user picked a different photo (different hash/size under the old key).
    attemptIdempotencyKeyRef.current = null
    setMyFormPhase('idle')
    setMyFormError(null)
    setMyFormErrorKey(null)
  }

  if (isLoading) {
    return (
      <View testID="silhouette-editor" style={styles.container}>
        <ActivityIndicator accessibilityLabel={t('wardrobe.silhouette.title')} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View testID="silhouette-editor" style={styles.container}>
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text>{loadError}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          testID="silhouette-load-retry"
          style={styles.primaryButton}
          onPress={() => void load()}
        >
          <Text style={styles.primaryButtonText}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Text>
        </Pressable>
      </View>
    )
  }

  if (!profile) return null

  const myFormImageUrl = profile.myForm?.imageAccess?.url ?? null

  return (
    <View testID="silhouette-editor" style={styles.container}>
      <View accessibilityRole="tablist" style={styles.tabRow}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'default_mannequin' }}
          testID="silhouette-tab-default"
          style={styles.tabButton}
          onPress={() => setActiveTab('default_mannequin')}
        >
          <Text style={styles.tabText}>{t('wardrobe.silhouette.mode_default')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'my_form' }}
          testID="silhouette-tab-my-form"
          style={styles.tabButton}
          onPress={() => setActiveTab('my_form')}
        >
          <Text style={styles.tabText}>{t('wardrobe.silhouette.mode_my_form')}</Text>
        </Pressable>
      </View>

      {activeTab === 'default_mannequin' ? (
        <View testID="silhouette-sliders">
          <SliderRow
            label={t('wardrobe.silhouette.height_slider_label')}
            value={heightSlider}
            disabled={isSavingSliders}
            onDecrement={() => adjustHeight(-1)}
            onIncrement={() => adjustHeight(1)}
            testIdPrefix="silhouette-height"
          />
          <SliderRow
            label={t('wardrobe.silhouette.build_slider_label')}
            value={buildSlider}
            disabled={isSavingSliders}
            onDecrement={() => adjustBuild(-1)}
            onIncrement={() => adjustBuild(1)}
            testIdPrefix="silhouette-build"
          />
          {sliderError ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Text>{sliderError}</Text>
              <Pressable
                accessibilityRole="button"
                testID="silhouette-slider-retry"
                onPress={() =>
                  void saveSliders(heightSlider, buildSlider, lastChangedFieldRef.current)
                }
              >
                <Text style={styles.link}>
                  {t('common.retry', { defaultValue: 'Retry' })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View testID="silhouette-my-form">
          <Text style={styles.guidanceText}>
            {t('wardrobe.silhouette.my_form_guidance')}
          </Text>
          <View style={styles.confirmRow}>
            <Switch
              accessibilityLabel={t('wardrobe.silhouette.my_form_confirm')}
              testID="silhouette-my-form-confirm"
              value={guidanceConfirmed}
              onValueChange={setGuidanceConfirmed}
            />
            <Text>{t('wardrobe.silhouette.my_form_confirm')}</Text>
          </View>

          {myFormError ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Text>{myFormError}</Text>
            </View>
          ) : null}

          {myFormPhase === 'idle' ? (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !guidanceConfirmed }}
                disabled={!guidanceConfirmed}
                testID="silhouette-my-form-camera"
                style={[
                  styles.primaryButton,
                  !guidanceConfirmed && styles.stepperDisabled,
                ]}
                onPress={() => void openMyFormCamera()}
              >
                <Text style={styles.primaryButtonText}>
                  {t('wardrobe.capture.camera')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !guidanceConfirmed }}
                disabled={!guidanceConfirmed}
                testID="silhouette-my-form-library"
                style={[
                  styles.primaryButton,
                  !guidanceConfirmed && styles.stepperDisabled,
                ]}
                onPress={() => void openMyFormLibrary()}
              >
                <Text style={styles.primaryButtonText}>
                  {t('wardrobe.silhouette.my_form_upload')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {myFormPhase === 'uploading' || myFormPhase === 'processing' ? (
            <View style={styles.uploadState} testID="silhouette-my-form-processing">
              <ActivityIndicator />
              <Text>{t('wardrobe.silhouette.processing')}</Text>
            </View>
          ) : null}

          {myFormPhase === 'failed' ? (
            <View testID="silhouette-my-form-failed">
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text>{myFormErrorKey ? t(myFormErrorKey) : myFormError}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                testID="silhouette-my-form-retry"
                style={styles.primaryButton}
                onPress={retryMyForm}
              >
                <Text style={styles.primaryButtonText}>
                  {t('wardrobe.silhouette.my_form_retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {myFormPhase === 'ready' ? (
            <View testID="silhouette-my-form-ready">
              <Text accessibilityRole="alert">{t('wardrobe.silhouette.ready')}</Text>
              {myFormImageUrl ? (
                <Image
                  source={{ uri: myFormImageUrl }}
                  accessibilityLabel={t('wardrobe.silhouette.mode_my_form')}
                  style={styles.myFormImage}
                  testID="silhouette-my-form-image"
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                testID="silhouette-my-form-remove"
                style={styles.secondaryButton}
                onPress={() => void removeMyForm()}
              >
                <Text style={styles.secondaryButtonText}>
                  {t('wardrobe.silhouette.my_form_remove')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  errorBox: { borderRadius: 12, backgroundColor: '#FEE2E2', padding: 12, gap: 8 },
  link: { color: '#8A5A00', fontWeight: '700', paddingVertical: 8 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#E4E4E7',
  },
  tabText: { fontWeight: '700' },
  sliderRow: { gap: 8, marginBottom: 12 },
  sliderLabel: { fontWeight: '700' },
  sliderControl: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#111111',
  },
  stepperDisabled: { opacity: 0.4 },
  stepperText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  sliderValue: { minWidth: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  guidanceText: { marginBottom: 8 },
  confirmRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  row: { flexDirection: 'row', gap: 12 },
  uploadState: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#111111',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    borderColor: '#d4d4d8',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: { color: '#3f3f46', fontWeight: '600' },
  myFormImage: { width: '100%', aspectRatio: 0.75, borderRadius: 16, marginVertical: 12 },
})
