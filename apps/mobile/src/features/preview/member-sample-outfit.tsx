import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  CreateSavedLookInput,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  buildHomeSampleSavedLookInput,
  createAnnouncementToken,
  createIdempotencyKey,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  isOfflineError,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  savedLookMatchesHomeSample,
  savedLookToSampleBookmark,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type SampleBookmark,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  reportNetworkOffline,
  setMobilePrimaryActionClearance,
  useStatusBar,
} from '@/components/save-feedback'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  listSavedLooksFromMobile,
  MobileSavedLookRequestError,
} from '@/src/lib/saved-looks'
import { PreviewButton, PreviewOutfit, PreviewSwapSheet } from './guest-preview-parts'
import { SampleIdeaControls } from './sample-idea-controls'

function toRecreateSampleInput(look: SavedLookContract): CreateSavedLookInput {
  return {
    source: look.source,
    lookId: look.lookId,
    weather: look.weather,
    title: look.title,
    anchorGarmentId: look.anchorGarmentId,
    anchorSnapshot: look.anchorSnapshot,
    composition: look.composition.map((slot) => ({
      slotIndex: slot.slotIndex,
      category: slot.category,
      kind: slot.kind,
      itemId: slot.itemId,
      label: slot.label,
    })),
    swaps: look.swaps,
    collection: look.collection,
    comfort: look.comfort,
  }
}

export function HomeAddGarment() {
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  useEffect(() => () => setMobilePrimaryActionClearance(0), [])
  return (
    <View
      testID="home-add-garment-container"
      onLayout={(event) => {
        const height = Math.ceil(event.nativeEvent.layout.height)
        if (height > 0) {
          setMobilePrimaryActionClearance(height + 8)
        }
      }}
    >
      <PreviewButton
        label={strings.firstUse.addGarment}
        testID="home-add-garment"
        palette={palette}
        onPress={() => router.navigate('/wardrobe?entry=add')}
        primary
      />
    </View>
  )
}

export function HomePlannerLink() {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  return (
    <View style={styles.plan}>
      <PreviewButton
        label={t('commerce.premium.planner.openControl')}
        testID="home-plan-week"
        palette={palette}
        onPress={() => router.push('/planner')}
      />
    </View>
  )
}

export function MemberSampleOutfit({
  owner,
  error,
  busy,
  onRetry,
}: {
  owner: string | null
  error: 'no-location' | 'generic' | null
  busy: boolean
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation()
  const statusBar = useStatusBar()
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const palette = useHeroPalette()
  const [result, setResult] = useState(createMemberSampleOutfit)
  const [category, setCategory] = useState<SampleGarmentCategory | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [bookmarkRevision, setBookmarkRevision] = useState(0)
  const [bookmarkStorage, setBookmarkStorage] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading')
  const savedLooksRef = useRef<SavedLookContract[]>([])
  savedLooksRef.current = savedLooks
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<SavedLookContract | null>(null)
  const lookUndoStackRef = useRef<SampleOutfitResult[]>([])
  const noticeSeqRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const readLiveOnline = () => statusBarRef.current.isOnline && getNetworkOnline()

  useEffect(() => {
    statusBarRef.current.dismissNotice()
    if (!owner) {
      savedLooksRef.current = []
      setSavedLooks([])
      setBookmarkStorage('loading')
      return
    }
    const controller = new AbortController()
    setBookmarkStorage('loading')
    void listSavedLooksFromMobile({ source: 'home_sample', signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted || mobileApplicationUserId() !== owner) return
        savedLooksRef.current = items
        setSavedLooks(items)
        setBookmarkStorage('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setBookmarkStorage('unavailable')
      })
    return () => {
      controller.abort()
      statusBarRef.current.dismissNotice()
    }
  }, [owner])

  const bookmarks: SampleBookmark[] = []
  const seenBookmarkLookIds = new Set<string>()
  for (const saved of savedLooks) {
    const bookmark = savedLookToSampleBookmark(saved)
    if (!bookmark || seenBookmarkLookIds.has(bookmark.lookId)) continue
    seenBookmarkLookIds.add(bookmark.lookId)
    bookmarks.push(bookmark)
  }
  const pushUndoAndUpdate = (next: SampleOutfitResult, message: string, kind: string) => {
    if (next === result) return
    lookUndoStackRef.current = pushLookUndoSnapshot(lookUndoStackRef.current, result)
    setResult(next)
    const seq = ++noticeSeqRef.current
    statusBar.showNotice({
      id: `sample-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`sample-${kind}`, seq),
      message,
      tone: 'neutral',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => {
            const { snapshot, rest } = popLookUndoSnapshot(lookUndoStackRef.current)
            lookUndoStackRef.current = rest
            if (snapshot) {
              setResult(snapshot)
              const undoSeq = ++noticeSeqRef.current
              statusBar.showNotice({
                id: `sample-${kind}-undo-${undoSeq}`,
                announcementId: createAnnouncementToken(`sample-${kind}-undo`, undoSeq),
                message: t('feedback.undone'),
                tone: 'neutral',
              })
            }
          },
        },
      ],
    })
  }
  const lookId = result.look?.id
  const currentId = result.garments.find((garment) => garment.category === category)?.id
  const garmentsSignature = result.garments.map((garment) => garment.id).join(',')

  return (
    <View testID="member-sample-outfit" style={styles.sample}>
      <Text style={{ color: palette.mutedText }}>{strings.chrome.sampleLabel}</Text>
      <PreviewOutfit
        result={result}
        strings={strings}
        palette={palette}
        locale={locale}
        heading={strings.firstUse.outfitIdea}
        continuation={
          <>
            <HomeAddGarment />
            {error === 'no-location' && (
              <View testID="hero-no-location-state">
                <PreviewButton
                  label={strings.firstUse.setCity}
                  testID="hero-add-location"
                  palette={palette}
                  onPress={() => router.push('/locations?guided=1')}
                />
              </View>
            )}
            {error === 'generic' && (
              <View testID="hero-error-state">
                <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
                  {strings.firstUse.outfitFailed}
                </Text>
                <PreviewButton
                  label={strings.chrome.retry}
                  testID="hero-retry"
                  palette={palette}
                  disabled={busy}
                  onPress={onRetry}
                />
              </View>
            )}
          </>
        }
        noAlternative={result.eligibleLookIds.length < 2}
        onTryAnother={() =>
          pushUndoAndUpdate(
            rotateMemberSampleOutfit(result),
            t('feedback.lookUpdated'),
            'shuffle'
          )
        }
        onSwap={setCategory}
        swapCategory={category}
        onUndoSwaps={() => setResult(undoMemberSampleSwaps)}
        onReviewChoices={() => {
          lookUndoStackRef.current = []
          saveAttemptKeysRef.current.clear()
          statusBar.dismissNotice()
          setResult(createMemberSampleOutfit())
        }}
        onResetChoices={() => {
          lookUndoStackRef.current = []
          saveAttemptKeysRef.current.clear()
          statusBar.dismissNotice()
          setResult(createMemberSampleOutfit())
        }}
      />
      <SampleIdeaControls
        strings={strings}
        palette={palette}
        preferences={result.input.preferences}
        onPreferences={(preferences) => {
          lookUndoStackRef.current = []
          saveAttemptKeysRef.current.clear()
          statusBar.dismissNotice()
          setResult((current) => updateMemberSampleOutfit(current, { preferences }))
        }}
        weather={result.input.weather}
        onWeather={(weather) => {
          lookUndoStackRef.current = []
          saveAttemptKeysRef.current.clear()
          statusBar.dismissNotice()
          setResult((current) => updateMemberSampleOutfit(current, { weather }))
        }}
        bookmarks={bookmarks}
        lookId={owner && bookmarkStorage !== 'loading' ? lookId : undefined}
        persistent={bookmarkStorage === 'ready'}
        showStorageFailureWhenEmpty={bookmarkStorage === 'unavailable'}
        ownerKey={owner}
        useSharedFeedback
        saveResetKey={`${owner ?? 'anon'}:${lookId ?? 'none'}:${garmentsSignature}:${result.input.weather}:${JSON.stringify(result.input.preferences)}:${bookmarkRevision}`}
        onSave={async () => {
          if (!lookId || !owner || mobileApplicationUserId() !== owner) return false
          lookUndoStackRef.current = []
          const payload = buildHomeSampleSavedLookInput(result)
          if (!payload) return false
          const existingMatch = savedLooksRef.current.find((item) =>
            savedLookMatchesHomeSample(item, result)
          )
          if (existingMatch) {
            lastCreatedRef.current = existingMatch
            setBookmarkStorage('ready')
            return true
          }
          const comfortSig = payload.comfort
            ? `${payload.comfort.runsColdWarm}/${payload.comfort.windTolerance}/${payload.comfort.precipPreparedness}`
            : ''
          const attemptKey = `${owner}:${lookId}:${garmentsSignature}:${result.input.weather}:${payload.collection ?? ''}:${comfortSig}`
          let idempotencyKey = saveAttemptKeysRef.current.get(attemptKey)
          if (!idempotencyKey) {
            idempotencyKey = createIdempotencyKey()
            saveAttemptKeysRef.current.set(attemptKey, idempotencyKey)
          }
          let created: SavedLookContract
          try {
            created = await createSavedLookFromMobile(payload, { idempotencyKey })
          } catch (error) {
            if (error instanceof MobileSavedLookRequestError && error.status === 409) {
              saveAttemptKeysRef.current.delete(attemptKey)
            }
            throw error
          }
          if (mobileApplicationUserId() !== owner) return false
          saveAttemptKeysRef.current.delete(attemptKey)
          lastCreatedRef.current = created
          const next = [
            created,
            ...savedLooksRef.current.filter((item) => item.id !== created.id),
          ]
          savedLooksRef.current = next
          setSavedLooks(next)
          setBookmarkStorage('ready')
          return true
        }}
        onUndoSave={async () => {
          const created = lastCreatedRef.current
          if (!created || !owner || mobileApplicationUserId() !== owner) return false
          await deleteSavedLookFromMobile(
            created.id,
            formatSavedLookIfMatch(created.id, created.revision)
          )
          if (mobileApplicationUserId() !== owner) return false
          lastCreatedRef.current = null
          const next = savedLooksRef.current.filter((item) => item.id !== created.id)
          savedLooksRef.current = next
          setSavedLooks(next)
          return true
        }}
        onOpen={(bookmark) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          setResult((current) => reopenMemberSampleOutfit(current, bookmark))
        }}
        onRemove={(id) => {
          const runRemove = async () => {
            if (!owner || mobileApplicationUserId() !== owner) return
            if (!readLiveOnline()) {
              const reachable = hasReliableBrowserOnline()
                ? false
                : await checkNetworkOnlineForAction()
              if (!reachable) {
                const offSeq = ++noticeSeqRef.current
                statusBarRef.current.showNotice({
                  id: `sample-remove-offline-${offSeq}`,
                  announcementId: createAnnouncementToken(
                    'sample-remove-offline',
                    offSeq
                  ),
                  message: t('feedback.offlineAction'),
                  tone: 'offline',
                  actions: [],
                })
                return
              }
            }
            const target = savedLooksRef.current.find((item) => item.lookId === id)
            if (!target) return
            setBookmarkRevision((value) => value + 1)
            try {
              await deleteSavedLookFromMobile(
                target.id,
                formatSavedLookIfMatch(target.id, target.revision)
              )
              if (mobileApplicationUserId() !== owner) return
              const next = savedLooksRef.current.filter((item) => item.id !== target.id)
              savedLooksRef.current = next
              setSavedLooks(next)
            } catch (error) {
              if (mobileApplicationUserId() !== owner) return
              const failSeq = ++noticeSeqRef.current
              if (isOfflineError(error) || !readLiveOnline()) {
                reportNetworkOffline()
                statusBarRef.current.showNotice({
                  id: `sample-remove-offline-${failSeq}`,
                  announcementId: createAnnouncementToken(
                    'sample-remove-offline',
                    failSeq
                  ),
                  message: t('feedback.offlineAction'),
                  tone: 'offline',
                  actions: [],
                })
              } else {
                statusBarRef.current.showNotice({
                  id: `sample-remove-failed-${failSeq}`,
                  announcementId: createAnnouncementToken(
                    'sample-remove-failed',
                    failSeq
                  ),
                  message: t('feedback.saveFailed'),
                  tone: 'error',
                  actions: [
                    {
                      id: 'retry',
                      kind: 'retry',
                      label: t('feedback.retry'),
                      onPress: () => {
                        void runRemove()
                      },
                    },
                  ],
                })
              }
              return
            }
            const seq = ++noticeSeqRef.current
            statusBarRef.current.showNotice({
              id: `sample-remove-${seq}`,
              announcementId: createAnnouncementToken('sample-remove', seq),
              message: t('feedback.removed'),
              tone: 'neutral',
              actions: [
                {
                  id: 'undo',
                  kind: 'undo',
                  label: t('feedback.undo'),
                  onPress: async () => {
                    if (mobileApplicationUserId() !== owner) return
                    if (!readLiveOnline()) {
                      const reachable = hasReliableBrowserOnline()
                        ? false
                        : await checkNetworkOnlineForAction()
                      if (!reachable) {
                        const offSeq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `sample-remove-undo-offline-${offSeq}`,
                          announcementId: createAnnouncementToken(
                            'sample-remove-undo-offline',
                            offSeq
                          ),
                          message: t('feedback.offlineAction'),
                          tone: 'offline',
                          actions: [],
                        })
                        return
                      }
                    }
                    try {
                      const restored = await createSavedLookFromMobile(
                        toRecreateSampleInput(target),
                        { idempotencyKey: createIdempotencyKey() }
                      )
                      if (mobileApplicationUserId() !== owner) return
                      const next = [
                        restored,
                        ...savedLooksRef.current.filter(
                          (item) => item.id !== restored.id
                        ),
                      ]
                      savedLooksRef.current = next
                      setSavedLooks(next)
                      const undoSeq = ++noticeSeqRef.current
                      statusBarRef.current.showNotice({
                        id: `sample-remove-undo-${undoSeq}`,
                        announcementId: createAnnouncementToken(
                          'sample-remove-undo',
                          undoSeq
                        ),
                        message: t('feedback.undone'),
                        tone: 'neutral',
                      })
                    } catch (undoError) {
                      const undoSeq = ++noticeSeqRef.current
                      const offline = isOfflineError(undoError) || !readLiveOnline()
                      if (offline) reportNetworkOffline()
                      statusBarRef.current.showNotice({
                        id: `sample-remove-undo-${offline ? 'offline' : 'failed'}-${undoSeq}`,
                        announcementId: createAnnouncementToken(
                          `sample-remove-undo-${offline ? 'offline' : 'failed'}`,
                          undoSeq
                        ),
                        message: offline
                          ? t('feedback.offlineAction')
                          : t('feedback.saveFailed'),
                        tone: offline ? 'offline' : 'error',
                        actions: [],
                      })
                    }
                  },
                },
              ],
            })
          }
          void runRemove()
        }}
      />
      <PreviewSwapSheet
        category={category}
        candidates={
          category ? sampleSwapCandidates(SAMPLE_CATALOG, category, result.input) : []
        }
        currentId={currentId}
        strings={strings}
        palette={palette}
        onChoose={(id) => {
          if (category) {
            pushUndoAndUpdate(
              swapMemberSampleGarment(result, category, id),
              t('feedback.pieceSwapped'),
              'swap'
            )
          }
          setCategory(null)
        }}
        onClose={() => setCategory(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  sample: { marginHorizontal: 16, marginTop: 12, gap: 8 },
  plan: { marginHorizontal: 16, marginTop: 8 },
})
