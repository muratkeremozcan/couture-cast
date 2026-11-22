import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
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
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type SampleBookmark,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useStatusBar } from '@/components/save-feedback'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import { sampleRecipeStorage } from '@/src/lib/sample-recipe-storage'
import { PreviewButton, PreviewOutfit, PreviewSwapSheet } from './guest-preview-parts'
import { SampleIdeaControls } from './sample-idea-controls'

export function HomeAddGarment() {
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  return (
    <PreviewButton
      label={strings.firstUse.addGarment}
      testID="home-add-garment"
      palette={palette}
      onPress={() => router.navigate('/wardrobe?entry=add')}
      primary
    />
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
  const lastSavedBeforeRef = useRef<{
    lookId: string
    previous: SampleBookmark | undefined
    previousIndex: number
  } | null>(null)
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
        saveResetKey={`${owner ?? 'anon'}:${lookId ?? 'none'}:${garmentsSignature}:${bookmarkRevision}`}
        onSave={() => {
          if (!lookId) return false
          lookUndoStackRef.current = []
          const currentList = bookmarksRef.current
          const previousIndex = currentList.findIndex(
            (bookmark) => bookmark.lookId === lookId
          )
          lastSavedBeforeRef.current = {
            lookId,
            previous: previousIndex >= 0 ? currentList[previousIndex] : undefined,
            previousIndex,
          }
          return updateBookmarks(saveSampleBookmark(currentList, result))
        }}
        onUndoSave={() => {
          if (!lookId) return false
          const captured = lastSavedBeforeRef.current
          const without = bookmarksRef.current.filter(
            (bookmark) => bookmark.lookId !== lookId
          )
          const next =
            captured && captured.lookId === lookId && captured.previous
              ? [
                  ...without.slice(
                    0,
                    Math.min(Math.max(captured.previousIndex, 0), without.length)
                  ),
                  captured.previous,
                  ...without.slice(
                    Math.min(Math.max(captured.previousIndex, 0), without.length)
                  ),
                ]
              : without
          return updateBookmarks(next)
        }}
        onOpen={(bookmark) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          setResult((current) => reopenMemberSampleOutfit(current, bookmark))
        }}
        onRemove={(id) => {
          const currentList = bookmarksRef.current
          const removedIndex = currentList.findIndex((bookmark) => bookmark.lookId === id)
          const removedBookmark =
            removedIndex >= 0 ? currentList[removedIndex] : undefined
          setBookmarkRevision((value) => value + 1)
          const ok = updateBookmarks(
            currentList.filter((bookmark) => bookmark.lookId !== id),
            { keepInMemoryOnError: true }
          )
          if (ok && removedBookmark) {
            const seq = ++noticeSeqRef.current
            statusBar.showNotice({
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
                    const latest = bookmarksRef.current.filter(
                      (bookmark) => bookmark.lookId !== id
                    )
                    const idx = Math.min(Math.max(removedIndex, 0), latest.length)
                    const restored = updateBookmarks([
                      ...latest.slice(0, idx),
                      removedBookmark,
                      ...latest.slice(idx),
                    ])
                    const undoSeq = ++noticeSeqRef.current
                    if (restored) {
                      statusBar.showNotice({
                        id: `sample-remove-undo-${undoSeq}`,
                        announcementId: createAnnouncementToken(
                          'sample-remove-undo',
                          undoSeq
                        ),
                        message: t('feedback.undone'),
                        tone: 'neutral',
                      })
                    } else {
                      statusBar.showNotice({
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
          }
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
