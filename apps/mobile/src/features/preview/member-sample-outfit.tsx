import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  applyBoundedListRemove,
  applyBoundedListSave,
  createAnnouncementToken,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  parseSampleBookmarks,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  saveSampleBookmark,
  swapMemberSampleGarment,
  undoBoundedListRemove,
  undoBoundedListSave,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type BoundedSaveMutation,
  type SampleBookmark,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { setMobilePrimaryActionClearance, useStatusBar } from '@/components/save-feedback'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import { sampleRecipeStorage } from '@/src/lib/sample-recipe-storage'
import { PreviewButton, PreviewOutfit, PreviewSwapSheet } from './guest-preview-parts'
import { SampleIdeaControls } from './sample-idea-controls'

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
  const [bookmarks, setBookmarks] = useState<SampleBookmark[]>([])
  const [bookmarkRevision, setBookmarkRevision] = useState(0)
  const [bookmarkStorage, setBookmarkStorage] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading')
  const bookmarksRef = useRef<SampleBookmark[]>([])
  bookmarksRef.current = bookmarks
  const lastSavedMutationRef = useRef<BoundedSaveMutation<SampleBookmark> | null>(null)
  const bookmarkWriter = useRef<((value: string) => void) | null>(null)
  const lookUndoStackRef = useRef<SampleOutfitResult[]>([])
  const noticeSeqRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  useEffect(() => {
    statusBarRef.current.dismissNotice()
    if (!owner) return
    let active = true
    void sampleRecipeStorage(
      `couturecast.member-sample-bookmarks.${encodeURIComponent(owner)}`
    )
      .then(({ read, write }) => {
        if (!active || mobileApplicationUserId() !== owner) return
        bookmarkWriter.current = write
        const loaded = parseSampleBookmarks(read(), SAMPLE_CATALOG)
        bookmarksRef.current = loaded
        setBookmarks(loaded)
        setBookmarkStorage('ready')
      })
      .catch(() => {
        if (active) setBookmarkStorage('unavailable')
      })
    return () => {
      active = false
      bookmarkWriter.current = null
      statusBarRef.current.dismissNotice()
    }
  }, [owner])
  const updateBookmarks = (
    next: SampleBookmark[],
    options?: { keepInMemoryOnError?: boolean }
  ): boolean => {
    if (!owner || mobileApplicationUserId() !== owner || bookmarkStorage === 'loading')
      return false
    if (!bookmarkWriter.current) {
      setBookmarkStorage('unavailable')
      return false
    }
    try {
      bookmarkWriter.current(JSON.stringify(next))
      bookmarksRef.current = next
      setBookmarks(next)
      setBookmarkStorage('ready')
      return true
    } catch {
      if (options?.keepInMemoryOnError) {
        bookmarksRef.current = next
        setBookmarks(next)
      }
      setBookmarkStorage('unavailable')
      return false
    }
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
          statusBar.dismissNotice()
          setResult(createMemberSampleOutfit())
        }}
        onResetChoices={() => {
          lookUndoStackRef.current = []
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
          statusBar.dismissNotice()
          setResult((current) => updateMemberSampleOutfit(current, { preferences }))
        }}
        weather={result.input.weather}
        onWeather={(weather) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          setResult((current) => updateMemberSampleOutfit(current, { weather }))
        }}
        bookmarks={bookmarks}
        lookId={owner && bookmarkStorage !== 'loading' ? lookId : undefined}
        persistent={bookmarkStorage === 'ready'}
        showStorageFailureWhenEmpty={bookmarkStorage === 'unavailable'}
        ownerKey={owner}
        useSharedFeedback
        saveResetKey={`${owner ?? 'anon'}:${lookId ?? 'none'}:${garmentsSignature}:${bookmarkRevision}`}
        onSave={() => {
          if (!lookId) return false
          lookUndoStackRef.current = []
          const [entry] = saveSampleBookmark([], result)
          if (!entry) return false
          const mutation = applyBoundedListSave({
            entries: bookmarksRef.current,
            entry,
            getKey: (bookmark) => bookmark.lookId,
          })
          const ok = updateBookmarks(mutation.next)
          if (ok) {
            lastSavedMutationRef.current = mutation
          }
          return ok
        }}
        onUndoSave={() => {
          if (!lookId) return false
          const captured = lastSavedMutationRef.current
          if (!captured || captured.savedKey !== lookId) return false
          const undone = undoBoundedListSave({
            entries: bookmarksRef.current,
            mutation: captured,
            getKey: (bookmark) => bookmark.lookId,
            isSameEntry: (a, b) => JSON.stringify(a) === JSON.stringify(b),
          })
          if (!undone.ok) return false
          return updateBookmarks(undone.next)
        }}
        onOpen={(bookmark) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          setResult((current) => reopenMemberSampleOutfit(current, bookmark))
        }}
        onRemove={(id) => {
          const removedMutation = applyBoundedListRemove({
            entries: bookmarksRef.current,
            key: id,
            getKey: (bookmark) => bookmark.lookId,
          })
          if (!removedMutation) return
          setBookmarkRevision((value) => value + 1)
          const ok = updateBookmarks(removedMutation.next, {
            keepInMemoryOnError: true,
          })
          if (!ok) {
            const failSeq = ++noticeSeqRef.current
            statusBarRef.current.showNotice({
              id: `sample-remove-failed-${failSeq}`,
              announcementId: createAnnouncementToken('sample-remove-failed', failSeq),
              message: t('feedback.saveFailed'),
              tone: 'error',
              actions: [
                {
                  id: 'retry',
                  kind: 'retry',
                  label: t('feedback.retry'),
                  onPress: () => {
                    const retryOk = updateBookmarks(
                      bookmarksRef.current.filter((bookmark) => bookmark.lookId !== id),
                      { keepInMemoryOnError: true }
                    )
                    if (retryOk) {
                      const okSeq = ++noticeSeqRef.current
                      statusBarRef.current.showNotice({
                        id: `sample-remove-${okSeq}`,
                        announcementId: createAnnouncementToken('sample-remove', okSeq),
                        message: t('feedback.removed'),
                        tone: 'neutral',
                      })
                    }
                  },
                },
              ],
            })
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
                onPress: () => {
                  const undone = undoBoundedListRemove({
                    entries: bookmarksRef.current,
                    mutation: removedMutation,
                    getKey: (bookmark) => bookmark.lookId,
                  })
                  const restored = undone.ok && updateBookmarks(undone.next)
                  const undoSeq = ++noticeSeqRef.current
                  if (restored) {
                    statusBarRef.current.showNotice({
                      id: `sample-remove-undo-${undoSeq}`,
                      announcementId: createAnnouncementToken(
                        'sample-remove-undo',
                        undoSeq
                      ),
                      message: t('feedback.undone'),
                      tone: 'neutral',
                    })
                  } else {
                    statusBarRef.current.showNotice({
                      id: `sample-remove-undo-failed-${undoSeq}`,
                      announcementId: createAnnouncementToken(
                        'sample-remove-undo-failed',
                        undoSeq
                      ),
                      message: t('feedback.saveFailed'),
                      tone: 'error',
                    })
                  }
                },
              },
            ],
          })
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
