// Story 4.1/4.2 owner (original), Story 4.4 Task 6 owner (this file's move +
// onboarding entry-point card): the mobile wardrobe hub. Moved here, out of
// app/(tabs)/wardrobe.tsx, so it's covered by the component test runner (see
// wardrobe-silhouette-screen.tsx for why app/ route files stay thin
// wrappers); apps/mobile/app/(tabs)/wardrobe.tsx now just re-exports this.
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet } from 'react-native'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'

import { Text, View } from '@/components/themed'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import { safeFindNodeHandle } from '@/src/lib/expo-native-helpers'

import { MobileGarmentCaptureModal } from '@/components/wardrobe/garment-capture-modal'
import { MobileGarmentTaggingModal } from '@/components/wardrobe/garment-tagging-modal'
import {
  getWardrobeOnboardingStateFromMobile,
  listGarmentsFromMobile,
  pollGarmentUntilSettled,
} from '@/src/lib/wardrobe'

export interface WardrobeHubScreenProps {
  /** Test-only override for the still-processing garment poll cadence. */
  pollOffsetsMs?: readonly number[]
}

export function WardrobeHubScreen({ pollOffsetsMs }: WardrobeHubScreenProps = {}) {
  const { t } = useTranslation()
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string>('')
  const [taggingInvokerNodeHandle, setTaggingInvokerNodeHandle] = useState<number | null>(
    null
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [timedOutGarmentIds, setTimedOutGarmentIds] = useState<Set<string>>(
    () => new Set()
  )
  const [showOnboardingCard, setShowOnboardingCard] = useState(false)
  const pollingAbortRef = useRef<AbortController | null>(null)
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)
  const isCaptureOpenRef = useRef(false)
  const addGarmentButtonRef = useRef<React.ElementRef<typeof Pressable> | null>(null)

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureOpen
  }, [isCaptureOpen])

  const loadGarments = useCallback(async (signal?: AbortSignal) => {
    const token = await resolveMobileAccessToken()
    if (!token) {
      throw new Error('AUTHENTICATION_REQUIRED')
    }
    setAccessToken(token)
    setGarments(await listGarmentsFromMobile(token, signal))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadGarments(controller.signal)
      .catch(() => undefined)
      .finally(() => setIsLoading(false))
    // The onboarding entry-point card fetch is independent of, and must never
    // block, the garment list: a stalled/erroring onboarding read shouldn't
    // hide the wardrobe hub's actual contents.
    void resolveMobileAccessToken()
      .then((token) => {
        if (!token || controller.signal.aborted) return null
        return getWardrobeOnboardingStateFromMobile(token, controller.signal)
      })
      .then((state) => {
        if (!state || controller.signal.aborted) return
        setShowOnboardingCard(state.status !== 'completed')
      })
      .catch(() => undefined)
    return () => {
      controller.abort()
      pollingAbortRef.current?.abort()
    }
  }, [loadGarments])

  const closeCapture = () => {
    setIsCaptureOpen(false)
    const pendingGarmentId = pendingTaggingGarmentIdRef.current
    pendingTaggingGarmentIdRef.current = null
    if (pendingGarmentId) {
      setTaggingInvokerNodeHandle(safeFindNodeHandle(addGarmentButtonRef.current))
      setTimeout(() => setTaggingGarmentId(pendingGarmentId), 0)
    }
  }

  const pollCommittedGarment = (garmentId: string, token: string) => {
    pollingAbortRef.current?.abort()
    const controller = new AbortController()
    pollingAbortRef.current = controller
    void (async () => {
      try {
        const settled = await pollGarmentUntilSettled(
          token,
          garmentId,
          controller.signal,
          setGarments,
          pollOffsetsMs
        )
        if (!settled) {
          setTimedOutGarmentIds((ids) => new Set(ids).add(garmentId))
          setErrorMessage(t('wardrobe.tagging.poll_timeout'))
          return
        }
        setTimedOutGarmentIds((ids) => {
          const next = new Set(ids)
          next.delete(garmentId)
          return next
        })
        if (settled.status === 'awaiting_tags') {
          if (isCaptureOpenRef.current) {
            pendingTaggingGarmentIdRef.current = settled.id
          } else {
            setTaggingInvokerNodeHandle(safeFindNodeHandle(addGarmentButtonRef.current))
            setTaggingGarmentId(settled.id)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(
            error instanceof Error ? error.message : t('wardrobe.tagging.load_failed')
          )
        }
      }
    })()
  }

  const openTaggingGarment = async (
    garmentId: string,
    invokingNodeHandle?: number | null
  ) => {
    const freshToken = await resolveMobileAccessToken()
    if (!freshToken) {
      setErrorMessage('AUTHENTICATION_REQUIRED')
      return
    }
    setAccessToken(freshToken)
    setTaggingInvokerNodeHandle(
      invokingNodeHandle ?? safeFindNodeHandle(addGarmentButtonRef.current)
    )
    setTaggingGarmentId(garmentId)
  }

  const handleGarmentCommitted = (garment: GarmentItemContract, token: string) => {
    setAccessToken(token)
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
    if (garment.status === 'awaiting_tags') {
      pendingTaggingGarmentIdRef.current = garment.id
    } else if (garment.status === 'processing') {
      pollCommittedGarment(garment.id, token)
    }
  }

  return (
    <>
      <View
        style={styles.screen}
        testID="wardrobe-screen"
        importantForAccessibility={taggingGarmentId ? 'no-hide-descendants' : 'auto'}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('wardrobe.title')}</Text>
              <Text style={styles.subtitle}>{t('wardrobe.empty_desc')}</Text>
            </View>
            <View style={styles.headerActions}>
              {/* The capsule screen had no entry point anywhere in the app. */}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('wardrobe.capsules.title')}
                testID="wardrobe-capsules-link"
                style={styles.secondaryButton}
                onPress={() => router.push('/wardrobe-capsules')}
              >
                <Text style={styles.secondaryButtonText}>
                  {t('wardrobe.capsules.title')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('wardrobe.silhouette.title')}
                testID="wardrobe-silhouette-link"
                style={styles.secondaryButton}
                onPress={() => router.push('/wardrobe-silhouette')}
              >
                <Text style={styles.secondaryButtonText}>
                  {t('wardrobe.silhouette.title')}
                </Text>
              </Pressable>
              <Pressable
                ref={addGarmentButtonRef}
                accessibilityRole="button"
                testID="garment-capture-open"
                style={styles.primaryButton}
                onPress={() => setIsCaptureOpen(true)}
              >
                <Text style={styles.primaryButtonText}>{t('wardrobe.add_garment')}</Text>
              </Pressable>
            </View>
          </View>

          {showOnboardingCard ? (
            <Pressable
              accessibilityRole="link"
              testID="wardrobe-onboarding-card"
              style={styles.onboardingCard}
              onPress={() => router.push('/wardrobe-onboarding')}
            >
              <Text style={styles.onboardingCardTitle}>
                {t('wardrobe.onboarding.title')}
              </Text>
              <Text style={styles.onboardingCardBody}>
                {t('wardrobe.onboarding.permission_body')}
              </Text>
            </Pressable>
          ) : null}

          {errorMessage ? (
            <View
              style={styles.errorBox}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              testID="wardrobe-error-banner"
            >
              <Text>{errorMessage}</Text>
            </View>
          ) : null}

          {isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading wardrobe" />
          ) : garments.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('wardrobe.empty_title')}</Text>
            </View>
          ) : (
            <View style={styles.grid} testID="wardrobe-garment-list">
              {garments.map((garment) => (
                <View key={garment.id} style={styles.garmentCard}>
                  {garment.imageAccess ? (
                    <Image
                      source={{ uri: garment.imageAccess.url }}
                      accessibilityLabel={t('wardrobe.capture.title')}
                      style={styles.garmentImage}
                    />
                  ) : null}
                  <Text numberOfLines={1} style={styles.garmentId}>
                    {garment.id}
                  </Text>
                  <Text testID={`garment-status-${garment.status}`}>
                    {garment.status}
                  </Text>
                  {(garment.status === 'awaiting_tags' ||
                    timedOutGarmentIds.has(garment.id)) && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('wardrobe.tagging.needs_tags', {
                        defaultValue: 'Needs tags',
                      })}
                      style={styles.needsTagsBtn}
                      onPress={(event) => {
                        void openTaggingGarment(
                          garment.id,
                          safeFindNodeHandle(event.currentTarget)
                        )
                      }}
                    >
                      <Text style={styles.needsTagsText}>
                        {t('wardrobe.tagging.needs_tags', { defaultValue: 'Needs tags' })}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <MobileGarmentCaptureModal
          visible={isCaptureOpen}
          onClose={closeCapture}
          onGarmentCommitted={handleGarmentCommitted}
          invokingNodeHandle={safeFindNodeHandle(addGarmentButtonRef.current)}
        />
      </View>

      <MobileGarmentTaggingModal
        visible={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        accessToken={accessToken}
        invokingNodeHandle={taggingInvokerNodeHandle}
        onTagsConfirmed={(updatedGarment) => {
          setGarments((current) =>
            current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
          )
          setTaggingGarmentId(null)
          void (async () => {
            const freshToken = await resolveMobileAccessToken()
            if (!freshToken) return
            setAccessToken(freshToken)
            setGarments(await listGarmentsFromMobile(freshToken))
          })().catch(() => undefined)
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  needsTagsBtn: {
    minHeight: 44,
    minWidth: 44,
    backgroundColor: '#FEF9EF',
    borderColor: '#C5A059',
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  needsTagsText: {
    color: '#8A5A00',
    fontWeight: '700',
    fontSize: 12,
  },
  content: { padding: 20, gap: 24 },
  header: { gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { marginTop: 6, opacity: 0.7 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#d4d4d8',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  secondaryButtonText: { color: '#3f3f46', fontSize: 13, fontWeight: '600' },
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
  onboardingCard: {
    borderRadius: 16,
    backgroundColor: '#FEF9EF',
    borderColor: '#C5A059',
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  onboardingCardTitle: { fontSize: 18, fontWeight: '700' },
  onboardingCardBody: { opacity: 0.8 },
  emptyState: { alignItems: 'center', borderRadius: 16, padding: 36 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  garmentCard: { width: '47%', overflow: 'hidden', borderRadius: 12, padding: 10 },
  garmentImage: { width: '100%', aspectRatio: 0.75, borderRadius: 8 },
  garmentId: { marginTop: 8, fontSize: 12 },
  errorBox: { borderRadius: 12, backgroundColor: '#FEE2E2', padding: 12, gap: 8 },
})
