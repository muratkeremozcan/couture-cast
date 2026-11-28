// Story 4.4 Task 6 step 1 owner: implement the mobile guided onboarding screen in apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx
// Story 4.4 Task 6 owner: guided mobile wardrobe onboarding, mirroring the Web
// flow (Task 5): a permission step, a capture/tagging loop that reuses the
// extracted MobileGarmentCaptureModal and the existing MobileGarmentTaggingModal
// with a running checklist, a "Use starter wardrobe" skip, an inline silhouette
// step (the shared SilhouetteEditor), and a completion step. Lives under
// src/features so it stays covered by the component test runner (see
// wardrobe-silhouette-screen.tsx for why app/wardrobe-onboarding.tsx stays a
// thin Stack.Screen wrapper instead).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type {
  GarmentItemContract,
  GarmentWithTags,
} from '@couture/api-client/contracts/http'

import { Text, View, createSchemeStyles, useSchemeColors } from '@/components/themed'
import { MobileGarmentCaptureModal } from '@/components/wardrobe/garment-capture-modal'
import { MobileGarmentTaggingModal } from '@/components/wardrobe/garment-tagging-modal'
import { SilhouetteEditor } from '@/components/wardrobe/silhouette-editor'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import {
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  getWardrobeOnboardingStateFromMobile,
  listGarmentsFromMobile,
  onboardingETag,
  pollGarmentUntilSettled,
  resolveOwnerUserId,
  updateWardrobeOnboardingStateFromMobile,
} from '@/src/lib/wardrobe'

const GUARDIAN_CONSENT_CODE = 'GUARDIAN_CONSENT_REQUIRED'

type UiPhase = 'permission' | 'capture' | 'silhouette' | 'complete'

function uiPhaseFor(step: string): UiPhase {
  if (step === 'permission') return 'permission'
  if (step === 'capture' || step === 'tagging') return 'capture'
  if (step === 'silhouette') return 'silhouette'
  return 'complete'
}

export function WardrobeOnboardingScreen() {
  const epoch = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileIdentityEpoch,
    mobileIdentityEpoch
  )
  return <MemberWardrobeOnboardingScreen key={epoch} epoch={epoch} />
}

// eslint-disable-next-line complexity
function MemberWardrobeOnboardingScreen({ epoch }: { epoch: number }) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const themed = useThemedStyles()
  const { announce } = useAccessibilityAnnouncer()

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [phase, setPhase] = useState<UiPhase>('permission')
  const [resumed, setResumed] = useState(false)
  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const [accessToken, setAccessToken] = useState('')
  const [garments, setGarments] = useState<Omit<GarmentWithTags, 'colorFamily'>[]>([])
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)

  const userIdRef = useRef('')
  const revisionRef = useRef(0)
  const pollAbortRef = useRef<AbortController | null>(null)
  // Story CC-7.9 D6: the stack's AppTopBar names the screen, so each step's first line takes the
  // accessibility focus on a step change (the capture step has no intro line: its first control).
  const stepFocusRef = useRef<ElementRef<typeof RNText> | null>(null)
  const addGarmentButtonRef = useRef<ElementRef<typeof Pressable> | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const token = await resolveMobileAccessToken()
      if (epoch !== mobileIdentityEpoch()) return
      if (!token) throw new Error(t('wardrobe.error.sign_in_required'))
      setAccessToken(token)
      userIdRef.current = await resolveOwnerUserId(token)
      if (epoch !== mobileIdentityEpoch()) return

      const state = await getWardrobeOnboardingStateFromMobile(token)
      if (epoch !== mobileIdentityEpoch()) return
      revisionRef.current = state.revision

      if (state.status === 'completed') {
        setIsRedirecting(true)
        router.replace('/wardrobe')
        return
      }

      const nextPhase = uiPhaseFor(state.currentStep)
      setPhase(nextPhase)
      setResumed(state.currentStep !== 'permission')

      if (nextPhase === 'capture') {
        const persisted = await listGarmentsFromMobile(token)
        if (epoch === mobileIdentityEpoch()) setGarments(persisted)
      }
    } catch (error) {
      if (epoch !== mobileIdentityEpoch()) return
      setLoadError(
        error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
          ? t('wardrobe.error.consent_required')
          : error instanceof Error
            ? error.message
            : t('wardrobe.onboarding.errors.load_failed')
      )
    } finally {
      if (epoch === mobileIdentityEpoch()) setIsLoading(false)
    }
  }, [epoch, t])

  useEffect(() => {
    void load()
    return () => pollAbortRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (isLoading || Platform.OS === 'web') return
    const node = safeFindNodeHandle(
      phase === 'capture' ? addGarmentButtonRef.current : stepFocusRef.current
    )
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }, [phase, isLoading])

  // Only fires once, right after the initial load resolves; `resumed`,
  // `announce`, and `t` are intentionally excluded so a later state change
  // never re-fires this specific announcement.
  useEffect(() => {
    if (resumed && !isLoading) {
      announce('feedback', t('wardrobe.onboarding.resumed'))
    }
  }, [isLoading]) // eslint-disable-line

  const lastAttemptRef = useRef<{
    targetStep: 'capture' | 'silhouette' | 'complete'
    usedStarterWardrobe?: boolean
  } | null>(null)

  const advanceTo = useCallback(
    async (
      targetStep: 'capture' | 'silhouette' | 'complete',
      usedStarterWardrobe?: boolean
    ) => {
      if (epoch !== mobileIdentityEpoch()) return
      lastAttemptRef.current = { targetStep, usedStarterWardrobe }
      setIsAdvancing(true)
      setAdvanceError(null)
      try {
        const next = await updateWardrobeOnboardingStateFromMobile(
          accessToken,
          usedStarterWardrobe === undefined
            ? { targetStep }
            : { targetStep, usedStarterWardrobe },
          onboardingETag(userIdRef.current, revisionRef.current)
        )
        if (epoch !== mobileIdentityEpoch()) return
        revisionRef.current = next.revision
        setPhase(uiPhaseFor(next.currentStep))
      } catch (error) {
        if (epoch !== mobileIdentityEpoch()) return
        const message =
          error instanceof Error && error.message === GUARDIAN_CONSENT_CODE
            ? t('wardrobe.error.consent_required')
            : error instanceof Error
              ? error.message
              : t('wardrobe.onboarding.errors.save_failed')
        setAdvanceError(message)
        announce('error', message)
      } finally {
        setIsAdvancing(false)
      }
    },
    [accessToken, announce, epoch, t]
  )

  /**
   * A stale-revision (412) failure leaves `revisionRef` unchanged, so simply
   * resubmitting the same attempt would repeat the same 412 forever. Refresh
   * the current state first so the retry carries a live If-Match.
   */
  const retryAdvance = useCallback(async () => {
    const attempt = lastAttemptRef.current
    if (!attempt) return
    try {
      const fresh = await getWardrobeOnboardingStateFromMobile(accessToken)
      revisionRef.current = fresh.revision
      setPhase(uiPhaseFor(fresh.currentStep))
    } catch {
      // If the refresh itself fails, fall through and retry with the
      // last-known revision anyway; advanceTo's own error handling covers it.
    }
    await advanceTo(attempt.targetStep, attempt.usedStarterWardrobe)
  }, [accessToken, advanceTo])

  const requestPermissionsAndContinue = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync()
    const library = await ImagePicker.requestMediaLibraryPermissionsAsync()
    setPermissionDenied(!camera.granted && !library.granted)
    await advanceTo('capture')
  }

  const pollCommittedGarment = useCallback((garmentId: string, token: string) => {
    pollAbortRef.current?.abort()
    const controller = new AbortController()
    pollAbortRef.current = controller
    void pollGarmentUntilSettled(token, garmentId, controller.signal, setGarments).catch(
      () => {
        // Aborted or transient network failure; the checklist row simply
        // keeps its last-known status until the user retries or reopens.
      }
    )
  }, [])

  const handleGarmentCommitted = (garment: GarmentItemContract, token: string) => {
    if (epoch !== mobileIdentityEpoch()) return
    setAccessToken(token)
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
    if (garment.status === 'processing') {
      pollCommittedGarment(garment.id, token)
    }
  }

  const closeCapture = () => setIsCaptureOpen(false)

  const useStarterWardrobe = () => {
    void advanceTo('silhouette', true)
  }

  const allGarmentsTagged =
    garments.length > 0 && garments.every((garment) => garment.status === 'ready')
  const canContinueFromCapture = allGarmentsTagged

  const garmentLabel = (garment: GarmentItemContract, index: number) =>
    garment.category
      ? t(`wardrobe.tagging.options.category.${garment.category}`)
      : `${t('wardrobe.capture.title')} ${index + 1}`

  if (isLoading || isRedirecting) {
    return (
      // The loading and error states carry their own testIDs so that
      // `wardrobe-onboarding-screen` means "the onboarding steps are on screen"
      // and nothing else. Sharing it across all three states made an E2E wait on
      // it return during the spinner, and made a failed load look identical to a
      // successful one until the next assertion reported the first step "not
      // found".
      <View style={styles.screen} testID="wardrobe-onboarding-screen-loading">
        <ActivityIndicator accessibilityLabel={t('wardrobe.onboarding.title')} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.screen} testID="wardrobe-onboarding-screen-error">
        <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
          <Text>{loadError}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          testID="onboarding-load-retry"
          style={[styles.primaryButton, themed.primaryButton]}
          onPress={() => void load()}
        >
          <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="wardrobe-onboarding-screen">
      {advanceError ? (
        <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
          <Text>{advanceError}</Text>
          <Pressable
            accessibilityRole="button"
            testID="onboarding-advance-retry"
            onPress={() => void retryAdvance()}
          >
            <Text style={[styles.link, themed.link]}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'permission' ? (
        <View testID="onboarding-permission-step">
          <RNText ref={stepFocusRef} style={[styles.body, { color: colors.ink }]}>
            {t('wardrobe.onboarding.permission_body')}
          </RNText>
          {permissionDenied ? (
            <View accessibilityRole="alert" style={[styles.errorBox, themed.errorBox]}>
              <Text>{t('wardrobe.onboarding.permission_denied')}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="onboarding-request-permission"
            style={[styles.primaryButton, themed.primaryButton]}
            disabled={isAdvancing}
            onPress={() => void requestPermissionsAndContinue()}
          >
            <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
              {t('wardrobe.onboarding.permission_title')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'capture' ? (
        <View testID="onboarding-capture-step">
          <View testID="onboarding-checklist">
            {garments.map((garment, index) => {
              const label = garmentLabel(garment, index)
              // Only 'ready' means tags are actually confirmed. Every other
              // status (pending_upload/bytes_uploaded/processing/
              // awaiting_tags/failed) must keep showing "needs tags" — a
              // garment still uploading or analyzing is not done, and
              // treating it as done here previously let Continue advance
              // before tagging was even possible.
              const isTagged = garment.status === 'ready'
              const isTappable = garment.status === 'awaiting_tags'
              return (
                <View
                  key={garment.id}
                  style={styles.checklistRow}
                  testID={`onboarding-checklist-${garment.id}`}
                >
                  <Text>
                    {isTagged
                      ? t('wardrobe.onboarding.checklist_tagged', { garment: label })
                      : t('wardrobe.onboarding.checklist_pending', { garment: label })}
                  </Text>
                  {isTappable ? (
                    <Pressable
                      accessibilityRole="button"
                      testID={`onboarding-tag-${garment.id}`}
                      onPress={() => setTaggingGarmentId(garment.id)}
                    >
                      <Text style={[styles.link, themed.link]}>
                        {t('wardrobe.tagging.needs_tags')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )
            })}
          </View>

          <Pressable
            ref={addGarmentButtonRef}
            accessibilityRole="button"
            testID="onboarding-add-garment"
            style={[styles.primaryButton, themed.primaryButton]}
            onPress={() => setIsCaptureOpen(true)}
          >
            <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
              {garments.length === 0
                ? t('wardrobe.add_garment')
                : t('wardrobe.onboarding.add_another')}
            </Text>
          </Pressable>

          {garments.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              testID="onboarding-use-starter"
              disabled={isAdvancing}
              onPress={useStarterWardrobe}
            >
              <Text style={[styles.link, themed.link]}>
                {t('wardrobe.onboarding.use_starter_wardrobe')}
              </Text>
            </Pressable>
          ) : null}

          {garments.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              aria-disabled={!canContinueFromCapture || isAdvancing}
              disabled={!canContinueFromCapture || isAdvancing}
              testID="onboarding-continue"
              style={[
                styles.primaryButton,
                themed.primaryButton,
                (!canContinueFromCapture || isAdvancing) && styles.disabledButton,
              ]}
              onPress={() => void advanceTo('silhouette')}
            >
              <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
                {t('wardrobe.onboarding.continue')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {phase === 'silhouette' ? (
        <View testID="onboarding-silhouette-step">
          <SilhouetteEditor />
          <Pressable
            accessibilityRole="button"
            testID="onboarding-finish"
            disabled={isAdvancing}
            style={[styles.primaryButton, themed.primaryButton]}
            onPress={() => void advanceTo('complete')}
          >
            <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
              {t('wardrobe.onboarding.continue')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'complete' ? (
        <View testID="onboarding-complete-step">
          <RNText ref={stepFocusRef} style={[styles.body, { color: colors.ink }]}>
            {t('wardrobe.onboarding.complete')}
          </RNText>
          <Pressable
            accessibilityRole="button"
            testID="onboarding-done"
            style={[styles.primaryButton, themed.primaryButton]}
            onPress={() => router.replace('/wardrobe')}
          >
            <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
              {t('common.done', { defaultValue: 'Done' })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <MobileGarmentCaptureModal
        visible={isCaptureOpen}
        onClose={closeCapture}
        onGarmentCommitted={handleGarmentCommitted}
        invokingNodeHandle={safeFindNodeHandle(addGarmentButtonRef.current)}
      />

      <MobileGarmentTaggingModal
        visible={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        initialGarment={garments.find((garment) => garment.id === taggingGarmentId)}
        accessToken={accessToken}
        onTagsConfirmed={(updatedGarment) => {
          setGarments((current) =>
            current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
          )
          setTaggingGarmentId(null)
        }}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 16 },
  body: { marginBottom: 12 },
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
  link: { fontWeight: '700', paddingVertical: 8 },
  checklistRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  disabledButton: { opacity: 0.4 },
  primaryButtonText: { fontWeight: '700' },
})

/**
 * Story CC-7.9 D2: the OS light/dark roles for the layout above. The buttons were always black
 * on white and the error box always light; now both follow the scheme.
 */
const useThemedStyles = createSchemeStyles((colors) => ({
  errorBox: { backgroundColor: colors.dangerSurface },
  link: { color: colors.ink },
  primaryButton: { backgroundColor: colors.inverse },
  primaryButtonText: { color: colors.onInverse },
}))
