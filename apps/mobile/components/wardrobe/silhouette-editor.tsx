// Story 4.4 Task 6 step 2 owner: implement the shared mobile silhouette editor in apps/mobile/components/wardrobe/silhouette-editor.tsx
// Story 4.4 Task 6 owner: shared silhouette editor (sliders + "My Form" photo
// pipeline). Reused as-is by both the standalone settings screen
// (wardrobe-silhouette.tsx) and the onboarding silhouette step
// (wardrobe-onboarding.tsx) so the two surfaces never diverge.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { File, Paths } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native'
// The themed Text follows the OS scheme, so copy without its own color stays legible on the
// dark screen; a plain react-native Text paints black there.
import { Text, createSchemeStyles, useSchemeColors } from '@/components/themed'
import {
  uploadGarmentBytes,
  UploadSessionChangedError,
  WARDROBE_UPLOAD_CACHE_CONTROL,
  type SilhouetteMode,
  type SilhouetteProfileContract,
  type SilhouettePhotoFailureReason,
  type UploadAttemptSession,
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
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import {
  createUploadAttempts,
  currentUploadSession,
  isUploadSessionCurrent,
  preparedImageFingerprint,
  resolveUploadBearer,
  runTrackedUpload,
  useUploadSessionChange,
} from '@/src/lib/upload-attempts'

const SLIDER_MIN = 0
const SLIDER_MAX = 100
const SLIDER_STEP = 5
const DEFAULT_POLL_INTERVAL_MS = 2_000
const POLL_MAX_ATTEMPTS = 15
const GUARDIAN_CONSENT_CODE = 'GUARDIAN_CONSENT_REQUIRED'

type MyFormPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed'

/** The account a loaded profile belongs to, with the verified bearer resolved for it. */
interface ProfileBinding {
  session: UploadAttemptSession
  bearer: string
}

/** Copy for a reload that finds nobody signed in, matching `resolveOwnerUserId`'s own. */
const SESSION_UNVERIFIED_MESSAGE = 'Your session could not be verified. Sign in again.'

/** Open My Form upload attempts in this app session, keyed by the prepared photo and account. */
const myFormUploadAttempts = createUploadAttempts<{
  uploadSessionId: string
  uploadUrl: string
  uploadToken: string
}>()

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

/**
 * The editor takes no bearer from its host (final review F-3): a host's token can still be the
 * previous account's after a sign-out (the onboarding screen stores its token before it mounts
 * the editor). Every read, slider save and removal runs on the bearer the app's resolver
 * verifies for the account signed in now (`resolveUploadBearer`).
 */
export interface SilhouetteEditorProps {
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
  const themed = useThemedStyles()
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
          aria-disabled={disabled || atMin}
          disabled={disabled || atMin}
          testID={`${testIdPrefix}-decrement`}
          style={[
            styles.stepperButton,
            themed.inverse,
            (disabled || atMin) && styles.stepperDisabled,
          ]}
          onPress={onDecrement}
        >
          <Text style={[styles.stepperText, themed.onInverse]}>−</Text>
        </Pressable>
        <Text style={styles.sliderValue} testID={`${testIdPrefix}-value`}>
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
          aria-disabled={disabled || atMax}
          disabled={disabled || atMax}
          testID={`${testIdPrefix}-increment`}
          style={[
            styles.stepperButton,
            themed.inverse,
            (disabled || atMax) && styles.stepperDisabled,
          ]}
          onPress={onIncrement}
        >
          <Text style={[styles.stepperText, themed.onInverse]}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// eslint-disable-next-line complexity
export function SilhouetteEditor({
  onProfileChange,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: SilhouetteEditorProps) {
  const { t } = useTranslation()
  const { announce } = useAccessibilityAnnouncer()
  const colors = useSchemeColors()
  const themed = useThemedStyles()

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
  const pollAbortRef = useRef<AbortController | null>(null)
  const lastChangedFieldRef = useRef<'height' | 'build'>('height')
  /**
   * Round 6: the account the shown profile was read under and the bearer verified for it. Null
   * until a read for the signed-in account lands, and cleared on every account change, so the
   * revision, the photo and Remove never outlive the account they belong to.
   */
  const bindingRef = useRef<ProfileBinding | null>(null)
  /** Advances on every load and on unmount, so only the newest load may apply its answer. */
  const loadGenerationRef = useRef(0)
  /**
   * The verified bearer for `session`, refused once the account changed. With no verified
   * bearer (signed out) nothing is read or removed.
   */
  const bearerForSession = useCallback(
    async (session: UploadAttemptSession): Promise<string> => {
      const bearer = await resolveUploadBearer(session, resolveMobileAccessToken)
      if (!bearer) throw new Error(SESSION_UNVERIFIED_MESSAGE)
      return bearer
    },
    []
  )

  const applyProfile = useCallback(
    (
      next: SilhouetteProfileContract,
      { keepTab = false }: { keepTab?: boolean } = {}
    ) => {
      setProfile(next)
      revisionRef.current = next.revision
      setHeightSlider(next.heightSlider ?? SLIDER_MAX / 2)
      setBuildSlider(next.buildSlider ?? SLIDER_MAX / 2)
      if (!keepTab) setActiveTab(next.mode)
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
    // Polls on the bearer of the account the processing photo belongs to; an account change
    // aborts the loop, and a read that was already on the wire is dropped when it lands.
    const binding = bindingRef.current
    if (pollAbortRef.current || !binding) return
    const controller = new AbortController()
    pollAbortRef.current = controller
    void (async () => {
      try {
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
          await waitForPoll(pollIntervalMs, controller.signal)
          const next = await getSilhouetteProfileFromMobile(
            binding.bearer,
            controller.signal
          )
          if (controller.signal.aborted || !isUploadSessionCurrent(binding.session))
            return
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
  }, [announce, applyProfile, pollIntervalMs, t])

  /**
   * Reads the profile of the account signed in now, on the bearer resolved for it. A reload
   * after an account change keeps the editor on screen (`keepTab`) with nothing of the previous
   * account left in it while the read runs. An answer that lands after the account changed
   * again, or after a newer load started, is dropped.
   */
  const load = useCallback(
    async ({ keepTab = false }: { keepTab?: boolean } = {}) => {
      const generation = ++loadGenerationRef.current
      const session = currentUploadSession()
      const isStale = () =>
        generation !== loadGenerationRef.current || !isUploadSessionCurrent(session)
      if (!keepTab) setIsLoading(true)
      setLoadError(null)
      try {
        const bearer = await bearerForSession(session)
        const ownerUserId = await resolveOwnerUserId(bearer)
        const next = await getSilhouetteProfileFromMobile(bearer)
        if (isStale()) return
        bindingRef.current = { session, bearer }
        userIdRef.current = ownerUserId
        applyProfile(next, { keepTab })
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
        if (isStale() || error instanceof UploadSessionChangedError) return
        setLoadError(
          error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
            ? t('wardrobe.error.consent_required')
            : error instanceof Error
              ? error.message
              : t('wardrobe.silhouette.errors.storage_error')
        )
      } finally {
        if (generation === loadGenerationRef.current) setIsLoading(false)
      }
    },
    [applyProfile, bearerForSession, pollMyForm, t]
  )

  useEffect(() => {
    void load()
    return () => {
      loadGenerationRef.current += 1
      pollAbortRef.current?.abort()
    }
  }, [load])

  /**
   * Round 5 account epoch, extended in round 6: the basewear confirmation, a failed photo, and
   * everything read for the previous account (profile, revision, signed photo URL, the bearer,
   * a running poll) belong to that account. Any account change (sign-out, or an auth state change
   * to another account) drops them and reads the profile again for the account signed in now,
   * so Remove and Retry only come back once that account's own verified read has landed.
   */
  const resetForAccountChange = useCallback(() => {
    bindingRef.current = null
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
    revisionRef.current = 0
    userIdRef.current = ''
    setProfile(null)
    setHeightSlider(SLIDER_MAX / 2)
    setBuildSlider(SLIDER_MAX / 2)
    setSliderError(null)
    setGuidanceConfirmed(false)
    setMyFormError(null)
    setMyFormErrorKey(null)
    setMyFormPhase('idle')
    void load({ keepTab: true })
  }, [load])
  useUploadSessionChange(resetForAccountChange)

  const saveSliders = useCallback(
    async (nextHeight: number, nextBuild: number, changedField: 'height' | 'build') => {
      // Saves for the account the shown profile was read under, with its bearer and revision.
      const binding = bindingRef.current
      if (!binding) return
      lastChangedFieldRef.current = changedField
      setIsSavingSliders(true)
      setSliderError(null)
      try {
        const next = await updateSilhouetteSlidersFromMobile(
          binding.bearer,
          { heightSlider: nextHeight, buildSlider: nextBuild },
          silhouetteETag(userIdRef.current, revisionRef.current)
        )
        if (!isUploadSessionCurrent(binding.session)) return
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
        if (!isUploadSessionCurrent(binding.session)) return
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
    [announce, applyProfile, t]
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

  const runMyFormUpload = async (
    asset: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'width' | 'height'>,
    uploadSession: UploadAttemptSession
  ) => {
    // The account changed while the camera or picker was open: the photo and the confirmation
    // were given under the previous account, so the photo is dropped.
    if (!isUploadSessionCurrent(uploadSession)) return
    setMyFormPhase('uploading')
    setMyFormError(null)
    setMyFormErrorKey(null)

    try {
      const maxDimension = Math.max(asset.width, asset.height)
      const scale = Math.min(1, 4096 / maxDimension)
      // Always re-encode, even when scale is 1 (no resize needed): the source
      // asset can be a JPEG or WebP (camera/library both hand back whatever
      // format the OS captured), and the allocation/upload/commit calls below
      // unconditionally declare `mimeType: 'image/jpeg'`. Skipping this step
      // for an already-small photo previously uploaded the original bytes
      // under a false mimeType. JPEG because a full-body photo has no
      // transparency, and as PNG it came to several megabytes.
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
        { compress: 0.9, format: SaveFormat.JPEG }
      )

      const file = new File(prepared.uri)
      const bytes = await file.bytes()
      const sha256 = await sha256Hex(bytes)
      // The bearer of the account the photo was picked under, resolved now and refused once the
      // account changed; an account change from here on fences the run.
      const bearer = await resolveUploadBearer(uploadSession, resolveMobileAccessToken)
      if (!bearer) throw new UploadSessionChangedError()

      // The prepared bytes name the attempt. Picking the same photo again after a failure
      // resumes it with the same keys while its outcome is ambiguous: commit first (a lost
      // answer replays), re-send the bytes only when the server reports them missing. A
      // different photo, or the same one after the server ended its attempt, gets fresh keys,
      // so a key never carries two declarations.
      const committed = await runTrackedUpload(
        myFormUploadAttempts,
        uploadSession,
        preparedImageFingerprint({
          sha256,
          fileSizeBytes: bytes.byteLength,
          mimeType: 'image/jpeg',
          widthPx: prepared.width,
          heightPx: prepared.height,
        }),
        {
          allocate: (allocateKey) =>
            createSilhouetteUploadUrlFromMobile(
              bearer,
              {
                fileSizeBytes: bytes.byteLength,
                mimeType: 'image/jpeg',
                sha256,
                widthPx: prepared.width,
                heightPx: prepared.height,
              },
              allocateKey
            ),
          upload: (allocation) =>
            uploadGarmentBytes({
              cacheControl: WARDROBE_UPLOAD_CACHE_CONTROL,
              // Commit verifies the stored bytes' sha256, so an object a lost answer left is safe.
              acceptExistingObject: true,
              uploadUrl: allocation.uploadUrl,
              uploadToken: allocation.uploadToken,
              bearerToken: bearer,
              mimeType: 'image/jpeg',
              body: bytes.buffer,
            }),
          commit: (allocation, commitKey) =>
            commitSilhouettePhotoFromMobile(
              bearer,
              {
                uploadSessionId: allocation.uploadSessionId,
                confirmsBasewearGuidance: true,
              },
              commitKey
            ),
        }
      )
      // An account change after the commit answered: the photo is the previous account's.
      if (!isUploadSessionCurrent(uploadSession)) return
      bindingRef.current = { session: uploadSession, bearer }
      applyProfile(committed)
      setMyFormPhase('processing')
      announce('feedback', t('wardrobe.silhouette.processing'))
      pollMyForm()
    } catch (error) {
      const message =
        error instanceof UploadSessionChangedError
          ? t('wardrobe.silhouette.errors.session_changed')
          : error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
            ? t('wardrobe.error.consent_required')
            : error instanceof Error
              ? error.message
              : t('wardrobe.silhouette.errors.storage_error')
      setMyFormPhase('failed')
      setMyFormError(message)
      announce('error', message)
    }
  }

  /**
   * `__DEV__`-only deterministic fixture, mirroring `garment-capture-modal.tsx`'s
   * `garment-e2e-fixture-source`: there is no other way for Maestro to drive a
   * real My Form photo through camera/library pickers deterministically. The
   * bundled asset is a portrait two-tone PNG engineered so the real production
   * `HeuristicSilhouettePhotoModerationEngine` deterministically returns
   * `ready` (see the story's Dev Notes for the exact pixel geometry) — this
   * exercises the real heuristic engine end to end, not a stubbed outcome.
   */
  const selectMyFormFixture = async () => {
    // Required lazily, matching garment-capture-modal.tsx's own reasoning: a
    // Vite/vitest environment has no Metro `require` for static assets, so
    // this must only ever run from the __DEV__-only button press below.
    const fixtureImage =
      require('../../assets/images/silhouette-my-form-fixture.png') as number
    const source = Image.resolveAssetSource(fixtureImage)
    const uploadSession = currentUploadSession()
    try {
      const fixtureFile = await File.downloadFileAsync(
        source.uri,
        new File(Paths.cache, 'silhouette-my-form-fixture.png'),
        { idempotent: true }
      )
      await runMyFormUpload(
        {
          uri: fixtureFile.uri,
          width: source.width,
          height: source.height,
        },
        uploadSession
      )
    } catch {
      setMyFormPhase('failed')
      setMyFormError(t('wardrobe.silhouette.errors.storage_error'))
    }
  }

  const openMyFormCamera = async () => {
    // Captured before the camera opens: the photo it returns belongs to this account.
    const uploadSession = currentUploadSession()
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
      void runMyFormUpload(result.assets[0], uploadSession)
    }
  }

  const openMyFormLibrary = async () => {
    // Captured before the picker opens: the photo it returns belongs to this account.
    const uploadSession = currentUploadSession()
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
      void runMyFormUpload(result.assets[0], uploadSession)
    }
  }

  const removeMyForm = async () => {
    // Removes for the account signed in now only: its verified bearer and the revision its own
    // read returned. Nothing is sent while that read has not landed.
    const binding = bindingRef.current
    if (!binding || !isUploadSessionCurrent(binding.session)) return
    try {
      const next = await deleteSilhouettePhotoFromMobile(
        binding.bearer,
        silhouetteETag(userIdRef.current, revisionRef.current)
      )
      if (!isUploadSessionCurrent(binding.session)) return
      applyProfile(next)
      setMyFormPhase('idle')
      setGuidanceConfirmed(false)
      announce('feedback', t('wardrobe.silhouette.mode_default'))
    } catch (error) {
      if (!isUploadSessionCurrent(binding.session)) return
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
    // Retry sends the user back to source selection. Picking the same photo resumes the failed
    // attempt with its keys; a different photo is a new attempt with a fresh key, so a key never
    // carries a second declaration (that once surfaced as 409 IDEMPOTENCY_KEY_REUSED).
    setMyFormPhase('idle')
    setMyFormError(null)
    setMyFormErrorKey(null)
  }

  // The loading and error states carry their own testIDs. They used to reuse
  // `silhouette-editor`, which made that id mean "this component exists in some
  // state" rather than "the editor is ready" -- so an E2E assertion on it passed
  // while the editor was still spinning or, worse, while it was showing an auth
  // error, and the very next tap reported the tab "not found" on a screen the
  // flow had just proved it was on. An id used as a synchronisation point has to
  // name exactly one state.
  if (isLoading) {
    return (
      <View testID="silhouette-editor-loading" style={styles.container}>
        <ActivityIndicator
          color={colors.ink}
          accessibilityLabel={t('wardrobe.silhouette.title')}
        />
      </View>
    )
  }

  if (loadError) {
    return (
      <View testID="silhouette-editor-error" style={styles.container}>
        <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
          <Text style={themed.errorText}>{loadError}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          testID="silhouette-load-retry"
          style={[styles.primaryButton, themed.inverse]}
          onPress={() => void load()}
        >
          <Text style={[styles.primaryButtonText, themed.onInverse]}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Text>
        </Pressable>
      </View>
    )
  }

  // A reload after an account change keeps the editor on screen with no profile yet.
  const myFormImageUrl = profile?.myForm?.imageAccess?.url ?? null

  return (
    <View testID="silhouette-editor" style={styles.container}>
      {/* The selected tab is filled; both tabs looked identical before. */}
      <View accessibilityRole="tablist" style={styles.tabRow}>
        <Pressable
          accessibilityRole="tab"
          aria-selected={activeTab === 'default_mannequin'}
          testID="silhouette-tab-default"
          style={[
            styles.tabButton,
            activeTab === 'default_mannequin' ? themed.inverse : themed.tab,
          ]}
          onPress={() => setActiveTab('default_mannequin')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'default_mannequin' && themed.onInverse,
            ]}
          >
            {t('wardrobe.silhouette.mode_default')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          aria-selected={activeTab === 'my_form'}
          testID="silhouette-tab-my-form"
          style={[
            styles.tabButton,
            activeTab === 'my_form' ? themed.inverse : themed.tab,
          ]}
          onPress={() => setActiveTab('my_form')}
        >
          <Text style={[styles.tabText, activeTab === 'my_form' && themed.onInverse]}>
            {t('wardrobe.silhouette.mode_my_form')}
          </Text>
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
            <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
              <Text style={themed.errorText}>{sliderError}</Text>
              <Pressable
                accessibilityRole="button"
                testID="silhouette-slider-retry"
                onPress={() =>
                  void saveSliders(heightSlider, buildSlider, lastChangedFieldRef.current)
                }
              >
                <Text style={[styles.link, themed.link]}>
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
            <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
              <Text style={themed.errorText}>{myFormError}</Text>
            </View>
          ) : null}

          {myFormPhase === 'idle' ? (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                aria-disabled={!guidanceConfirmed}
                disabled={!guidanceConfirmed}
                testID="silhouette-my-form-camera"
                style={[
                  styles.primaryButton,
                  themed.inverse,
                  !guidanceConfirmed && styles.stepperDisabled,
                ]}
                onPress={() => void openMyFormCamera()}
              >
                <Text style={[styles.primaryButtonText, themed.onInverse]}>
                  {t('wardrobe.capture.camera')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                aria-disabled={!guidanceConfirmed}
                disabled={!guidanceConfirmed}
                testID="silhouette-my-form-library"
                style={[
                  styles.primaryButton,
                  themed.inverse,
                  !guidanceConfirmed && styles.stepperDisabled,
                ]}
                onPress={() => void openMyFormLibrary()}
              >
                <Text style={[styles.primaryButtonText, themed.onInverse]}>
                  {t('wardrobe.silhouette.my_form_upload')}
                </Text>
              </Pressable>
              {__DEV__ ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Use deterministic My Form fixture"
                  aria-disabled={!guidanceConfirmed}
                  disabled={!guidanceConfirmed}
                  testID="silhouette-my-form-fixture-source"
                  style={[
                    styles.secondaryButton,
                    themed.outline,
                    !guidanceConfirmed && styles.stepperDisabled,
                  ]}
                  onPress={() => void selectMyFormFixture()}
                >
                  <Text style={styles.secondaryButtonText}>
                    Use deterministic My Form fixture
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {myFormPhase === 'uploading' || myFormPhase === 'processing' ? (
            <View style={styles.uploadState} testID="silhouette-my-form-processing">
              <ActivityIndicator color={colors.ink} />
              <Text>{t('wardrobe.silhouette.processing')}</Text>
            </View>
          ) : null}

          {myFormPhase === 'failed' ? (
            <View testID="silhouette-my-form-failed">
              <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
                <Text style={themed.errorText}>
                  {myFormErrorKey ? t(myFormErrorKey) : myFormError}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                testID="silhouette-my-form-retry"
                style={[styles.primaryButton, themed.inverse]}
                onPress={retryMyForm}
              >
                <Text style={[styles.primaryButtonText, themed.onInverse]}>
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
                style={[styles.secondaryButton, themed.outline]}
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
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
  link: { fontWeight: '700', paddingVertical: 8 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
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
    borderRadius: 12,
  },
  stepperDisabled: { opacity: 0.4 },
  stepperText: { fontSize: 20, fontWeight: '700' },
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButtonText: { fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: { fontWeight: '600' },
  myFormImage: { width: '100%', aspectRatio: 0.75, borderRadius: 16, marginVertical: 12 },
})

/** The OS light/dark colors for the layout above. */
const useThemedStyles = createSchemeStyles((colors) => ({
  errorBox: { backgroundColor: colors.dangerSurface },
  errorText: { color: colors.dangerInk },
  link: { color: colors.noticeInk },
  tab: { backgroundColor: colors.line },
  inverse: { backgroundColor: colors.inverse },
  onInverse: { color: colors.onInverse },
  outline: { borderColor: colors.lineStrong },
}))
