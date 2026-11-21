import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  MAX_SAMPLE_BOOKMARK_BYTES,
  parseSampleBookmarks,
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
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import { PreviewButton, PreviewOutfit, PreviewSwapSheet } from './guest-preview-parts'
import { SampleIdeaControls } from './sample-idea-controls'

async function memberBookmarkStorage(owner: string) {
  const key = `couturecast.member-sample-bookmarks.${encodeURIComponent(owner)}`
  if (Platform.OS === 'web') {
    return {
      read: () => globalThis.localStorage.getItem(key),
      write: (value: string) => globalThis.localStorage.setItem(key, value),
    }
  }
  const { File, Paths } = await import('expo-file-system')
  const file = new File(Paths.document, `${key}.json`)
  return {
    read: () =>
      file.exists && file.size <= MAX_SAMPLE_BOOKMARK_BYTES ? file.textSync() : null,
    write: (value: string) => file.write(value),
  }
}

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
  const { i18n } = useTranslation()
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const palette = useHeroPalette()
  const [result, setResult] = useState(createMemberSampleOutfit)
  const [category, setCategory] = useState<SampleGarmentCategory | null>(null)
  const [bookmarks, setBookmarks] = useState<SampleBookmark[]>([])
  const [bookmarkStorage, setBookmarkStorage] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading')
  const bookmarkWriter = useRef<((value: string) => void) | null>(null)
  useEffect(() => {
    if (!owner) return
    let active = true
    void memberBookmarkStorage(owner)
      .then(({ read, write }) => {
        if (!active || mobileApplicationUserId() !== owner) return
        bookmarkWriter.current = write
        setBookmarks(parseSampleBookmarks(read(), SAMPLE_CATALOG))
        setBookmarkStorage('ready')
      })
      .catch(() => {
        if (active) setBookmarkStorage('unavailable')
      })
    return () => {
      active = false
      bookmarkWriter.current = null
    }
  }, [owner])
  const updateBookmarks = (next: SampleBookmark[]) => {
    if (!owner || mobileApplicationUserId() !== owner || bookmarkStorage === 'loading')
      return
    setBookmarks(next)
    try {
      if (!bookmarkWriter.current) return
      bookmarkWriter.current(JSON.stringify(next))
      setBookmarkStorage('ready')
    } catch {
      setBookmarkStorage('unavailable')
    }
  }
  const lookId = result.look?.id
  const currentId = result.garments.find((garment) => garment.category === category)?.id

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
        onTryAnother={() => setResult(rotateMemberSampleOutfit)}
        onSwap={setCategory}
        swapCategory={category}
        onUndoSwaps={() => setResult(undoMemberSampleSwaps)}
        onReviewChoices={() => setResult(createMemberSampleOutfit())}
        onResetChoices={() => setResult(createMemberSampleOutfit())}
      />
      <SampleIdeaControls
        strings={strings}
        palette={palette}
        preferences={result.input.preferences}
        onPreferences={(preferences) =>
          setResult((current) => updateMemberSampleOutfit(current, { preferences }))
        }
        weather={result.input.weather}
        onWeather={(weather) =>
          setResult((current) => updateMemberSampleOutfit(current, { weather }))
        }
        bookmarks={bookmarks}
        lookId={owner && bookmarkStorage !== 'loading' ? lookId : undefined}
        persistent={bookmarkStorage === 'ready'}
        showStorageFailureWhenEmpty={bookmarkStorage === 'unavailable'}
        onSave={() => updateBookmarks(saveSampleBookmark(bookmarks, result))}
        onOpen={(bookmark) =>
          setResult((current) => reopenMemberSampleOutfit(current, bookmark))
        }
        onRemove={(id) =>
          updateBookmarks(bookmarks.filter((bookmark) => bookmark.lookId !== id))
        }
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
          if (category)
            setResult((current) => swapMemberSampleGarment(current, category, id))
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
