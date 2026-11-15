// Story 6.16 owner: the mobile guest preview. It resolves the stored session first (D1),
// gates on self-reported age (D2), then runs the shared sample policy over local guest
// state (D5, D7). Members go back to Home; nothing here calls a member API.
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  formatPreviewString,
  GUEST_PREVIEW_CONVERSION_INTENT,
  getGuestPreviewStrings,
  nextSampleLook,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleSwapCandidates,
  selectSampleOutfit,
  toggleSampleVote,
  toSampleSelectionInput,
  type GuestPreviewSnapshot,
  type GuestPreviewState,
  type GuestPreviewView,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { guestPreviewAnalytics, mobileGuestPreviewStore } from '@/src/lib/guest-preview'
import { useMemberSessionState } from '@/src/lib/member-session'
import {
  PreviewButton,
  PreviewControls,
  PreviewConversion,
  PreviewFeedback,
  PreviewGate,
  PreviewOutfit,
  PreviewSwapSheet,
  PreviewWardrobe,
  previewStyles,
  type PreviewControl,
} from './guest-preview-parts'

function useSnapshot(enabled: boolean): GuestPreviewSnapshot | null {
  const store = mobileGuestPreviewStore()
  const [snapshot, setSnapshot] = useState<GuestPreviewSnapshot | null>(null)
  useEffect(() => {
    if (!enabled) return
    let active = true
    const unsubscribe = store.subscribe((next) => {
      if (active) setSnapshot(next)
    })
    void store.load().then((loaded) => {
      if (active) setSnapshot(loaded)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [store, enabled])
  return snapshot
}

/** One policy result per state; the previous one lets a no-op change say it still suits. */
function useSampleResult(state: GuestPreviewState | null): SampleOutfitResult | null {
  const previous = useRef<SampleOutfitResult | undefined>(undefined)
  const result = useMemo(
    () =>
      state
        ? selectSampleOutfit(
            toSampleSelectionInput(state),
            SAMPLE_CATALOG,
            previous.current
          )
        : null,
    [state]
  )
  useEffect(() => {
    previous.current = result ?? undefined
  }, [result])
  return result
}

export function GuestPreviewScreen() {
  const { i18n } = useTranslation()
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const palette = useHeroPalette()
  const store = mobileGuestPreviewStore()
  const [session, retrySession] = useMemberSessionState()
  const snapshot = useSnapshot(session === 'signed-out')
  const state = snapshot?.state ?? null
  const result = useSampleResult(state)
  const [noAlternative, setNoAlternative] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [swapCategory, setSwapCategory] = useState<SampleGarmentCategory | null>(null)

  useEffect(() => {
    if (session === 'member') router.replace('/')
  }, [session])

  const update = (change: (current: GuestPreviewState) => GuestPreviewState) => {
    setNoAlternative(false)
    return store.update(change)
  }

  const frame = (children: React.ReactNode, testID = 'guest-preview-screen') => (
    <ScrollView
      testID={testID}
      style={[previewStyles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={previewStyles.content}
    >
      <Text
        testID="guest-preview-label"
        accessibilityRole="text"
        style={[previewStyles.label, { backgroundColor: '#FFF8E6', color: '#5A4310' }]}
      >
        {strings.chrome.sampleLabel}
      </Text>
      {children}
    </ScrollView>
  )

  if (session === 'unavailable') {
    return frame(
      <View testID="guest-preview-session-unavailable" style={{ gap: 12 }}>
        <Text accessibilityRole="alert" style={{ color: palette.text }}>
          {strings.chrome.sessionUnavailable}
        </Text>
        <PreviewButton
          label={strings.chrome.retry}
          onPress={retrySession}
          testID="guest-preview-retry"
          palette={palette}
          primary
        />
      </View>
    )
  }
  if (session !== 'signed-out' || !snapshot) {
    return frame(
      <Text
        testID="guest-preview-checking"
        accessibilityLiveRegion="polite"
        style={{ color: palette.mutedText }}
      >
        {strings.chrome.checkingSession}
      </Text>
    )
  }
  if (!state || !result) {
    return frame(
      <PreviewGate
        strings={strings}
        palette={palette}
        onEligible={() => {
          store.start()
          guestPreviewAnalytics.started()
        }}
        onExit={() => router.replace('/')}
      />
    )
  }

  const input = toSampleSelectionInput(state)
  const view = state.view
  const lookId = result.look?.id
  const lookSwaps = lookId ? state.swaps[lookId] : undefined
  const usableIds = new Set(
    result.garments.flatMap((garment) =>
      sampleSwapCandidates(SAMPLE_CATALOG, garment.category, input)
        .filter((candidate) => candidate.id !== garment.id)
        .map((candidate) => candidate.id)
    )
  )
  const navigate = (next: GuestPreviewView) => {
    update((current) => ({ ...current, view: next }))
    if (next === 'wardrobe') guestPreviewAnalytics.interacted('wardrobe_opened')
  }
  const applySwap = (category: SampleGarmentCategory, garmentId: string) => {
    if (!lookId) return
    update((current) => ({
      ...current,
      swaps: {
        ...current.swaps,
        [lookId]: { ...current.swaps[lookId], [category]: garmentId },
      },
    }))
    guestPreviewAnalytics.interacted('garment_swapped')
    const garment = SAMPLE_CATALOG.garments.find((item) => item.id === garmentId)
    if (garment) {
      setAnnouncement(
        formatPreviewString(strings.outfit.swapped, {
          garment: sampleGarmentText(garment, strings).name,
        })
      )
    }
  }
  const control = (name: PreviewControl | 'collection' | 'category') =>
    guestPreviewAnalytics.interacted('control_changed', name)
  const convert = (action: 'create_account' | 'sign_in') => {
    update((current) => ({
      ...current,
      conversion: { intent: GUEST_PREVIEW_CONVERSION_INTENT },
    }))
    guestPreviewAnalytics.signupClicked(action)
    router.push(
      action === 'create_account' ? '/signup?from=preview' : '/signin?from=preview'
    )
  }
  const tabs: { view: GuestPreviewView; label: string }[] = [
    { view: 'outfit', label: strings.chrome.navOutfit },
    { view: 'wardrobe', label: strings.chrome.navWardrobe },
    { view: 'preferences', label: strings.chrome.navPreferences },
  ]

  return frame(
    <>
      {!snapshot.persistent ? (
        <Text
          testID="guest-preview-storage"
          accessibilityLiveRegion="polite"
          style={{ color: '#5A4310' }}
        >
          {strings.chrome.storageUnavailable}
        </Text>
      ) : null}
      <Text
        testID="guest-preview-announcement"
        accessibilityLiveRegion="polite"
        style={{ height: 0, opacity: 0 }}
      >
        {announcement}
      </Text>
      <View
        accessibilityRole="tablist"
        accessibilityLabel={strings.chrome.navLabel}
        style={previewStyles.tabs}
      >
        {tabs.map((tab) => {
          const selected = tab.view === view
          return (
            <Pressable
              key={tab.view}
              testID={`guest-preview-nav-${tab.view}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => navigate(tab.view)}
              style={[
                previewStyles.tab,
                selected
                  ? { backgroundColor: palette.text, borderColor: palette.text }
                  : { borderColor: palette.divider },
              ]}
            >
              <Text
                style={{
                  color: selected ? palette.background : palette.text,
                  fontWeight: '600',
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {view === 'wardrobe' ? (
        <PreviewWardrobe
          strings={strings}
          palette={palette}
          collection={state.collection}
          usableIds={usableIds}
          onCollection={(collection) => {
            update((current) => ({ ...current, collection }))
            control('collection')
          }}
          onCategory={() => control('category')}
          onInspect={() => guestPreviewAnalytics.interacted('item_inspected')}
          onUse={(garment) => applySwap(garment.category, garment.id)}
          onBackToOutfit={() => navigate('outfit')}
        />
      ) : view === 'preferences' ? (
        <PreviewFeedback
          votes={state.votes}
          strings={strings}
          palette={palette}
          onVote={(id, vote) => {
            update((current) => ({
              ...current,
              votes: toggleSampleVote(current.votes, id, vote),
            }))
            guestPreviewAnalytics.interacted('look_voted')
          }}
          onReset={() => {
            update((current) => ({ ...current, votes: {} }))
            guestPreviewAnalytics.interacted('votes_reset')
          }}
        />
      ) : (
        <PreviewOutfit
          result={result}
          strings={strings}
          locale={locale}
          palette={palette}
          noAlternative={noAlternative}
          hasSwaps={lookSwaps !== undefined && Object.keys(lookSwaps).length > 0}
          onTryAnother={() => {
            const next = nextSampleLook(result)
            if ('lookId' in next) {
              update((current) => ({ ...current, selectedLookId: next.lookId }))
              guestPreviewAnalytics.interacted('look_changed')
            } else {
              setNoAlternative(true)
            }
          }}
          onSwap={setSwapCategory}
          onUndoSwaps={() => {
            if (!lookId) return
            update((current) => {
              const { [lookId]: _removed, ...rest } = current.swaps
              void _removed
              return { ...current, swaps: rest }
            })
            guestPreviewAnalytics.interacted('swaps_undone')
          }}
          onBrowseWardrobe={() => navigate('wardrobe')}
          onReviewChoices={() => navigate('preferences')}
          onResetChoices={() => {
            update((current) => ({ ...current, votes: {} }))
            guestPreviewAnalytics.interacted('votes_reset')
          }}
        />
      )}
      {view !== 'wardrobe' ? (
        <PreviewControls
          state={state}
          strings={strings}
          locale={locale}
          palette={palette}
          onWeather={(weather) => {
            update((current) => ({ ...current, weather }))
            control('weather')
          }}
          onComfort={(comfort, name) => {
            update((current) => ({ ...current, comfort }))
            control(name)
          }}
        />
      ) : null}
      <PreviewConversion
        strings={strings}
        palette={palette}
        onCreateAccount={() => convert('create_account')}
        onSignIn={() => convert('sign_in')}
      />
      <PreviewButton
        label={strings.chrome.resetPreview}
        onPress={() => {
          setNoAlternative(false)
          store.reset()
          guestPreviewAnalytics.interacted('preview_reset')
        }}
        testID="guest-preview-reset"
        palette={palette}
      />
      <PreviewButton
        label={strings.chrome.exitPreview}
        onPress={() => {
          guestPreviewAnalytics.interacted('preview_exited')
          store.clear()
          router.replace('/')
        }}
        testID="guest-preview-exit"
        palette={palette}
      />
      <PreviewSwapSheet
        category={swapCategory}
        candidates={
          swapCategory ? sampleSwapCandidates(SAMPLE_CATALOG, swapCategory, input) : []
        }
        currentId={
          swapCategory
            ? result.garments.find((garment) => garment.category === swapCategory)?.id
            : undefined
        }
        strings={strings}
        palette={palette}
        onChoose={(garmentId) => {
          if (swapCategory) applySwap(swapCategory, garmentId)
          setSwapCategory(null)
        }}
        onClose={() => setSwapCategory(null)}
      />
    </>
  )
}
