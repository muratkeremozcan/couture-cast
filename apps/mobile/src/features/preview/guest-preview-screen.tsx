// Story 6.16 owner: the mobile guest preview. It resolves the stored session first (D1),
// gates on self-reported age (D2), then runs the shared sample policy over local guest
// state (D5, D7). Members go back to Home; nothing here calls a member API.
import { router, useFocusEffect } from 'expo-router'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react'
import { ScrollView, Text, View, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  beginGuestLookSave,
  formatPreviewString,
  GUEST_PREVIEW_GARMENT_INTENT,
  GUEST_PREVIEW_SAVE_INTENT,
  getGuestPreviewStrings,
  nextSampleLook,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleSwapCandidates,
  sampleOutfitSwapOptions,
  selectSampleOutfit,
  toggleSampleVote,
  toSampleSelectionInput,
  withoutConversionIntent,
  type GuestPreviewSnapshot,
  type GuestPreviewState,
  type GuestPreviewView,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { guestPreviewAnalytics, mobileGuestPreviewStore } from '@/src/lib/guest-preview'
import { StyleMoodRow } from './style-profile-controls'
import { GuestStyleChoices } from './sample-idea-controls'
import { mobileGuestPreviewBirthdate } from '@/src/lib/guest-preview-birthdate'
import { useMemberSessionState } from '@/src/lib/member-session'
import {
  PreviewButton,
  PreviewControls,
  PreviewConversion,
  PreviewFeedback,
  PreviewGate,
  PreviewOutfit,
  PreviewSheet,
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
  const saveInvoker = useRef<ComponentRef<typeof Pressable>>(null)
  const [savePreviewStartedAt, setSavePreviewStartedAt] = useState<number | null>(null)
  const [previewExpired, setPreviewExpired] = useState(false)
  const [comfortExpanded, setComfortExpanded] = useState(false)

  // TEA M1: the preview stays mounted under signup and sign-in, so it acts on the session
  // only while focused. A sign-in from the preview makes the session a member while the
  // preview is hidden; acting then would clear the intent and replace the review with Home.
  useFocusEffect(
    useCallback(() => {
      if (session === 'member') {
        // Review F3: guest state left on this device never reaches a member.
        mobileGuestPreviewBirthdate.clear()
        store.clear()
        router.replace('/')
        return
      }
      if (session !== 'signed-out') return
      // Review F3: a guest back on the preview has left signup or sign-in, so a stored
      // carryover intent no longer stands. Back pops to this mounted screen, so this runs
      // on focus, and once more when the first load lands.
      const dropIntent = (current: GuestPreviewSnapshot) => {
        if (current.state?.conversion) store.update(withoutConversionIntent)
      }
      dropIntent(store.snapshot())
      let focused = true
      void store.load().then((loaded) => {
        if (focused) dropIntent(loaded)
      })
      return () => {
        focused = false
      }
    }, [session, store])
  )

  const update = (change: (current: GuestPreviewState) => GuestPreviewState) => {
    setNoAlternative(false)
    return store.update(change)
  }

  const frame = (children: React.ReactNode, testID = 'guest-preview-screen') => (
    <ScrollView
      testID={testID}
      style={[previewStyles.screen, { backgroundColor: palette.page }]}
      contentContainerStyle={previewStyles.content}
    >
      <Text
        testID="guest-preview-label"
        accessibilityRole="text"
        style={[previewStyles.label, { color: palette.inkMuted }]}
      >
        {strings.firstRun.sampleLabel}
      </Text>
      {children}
    </ScrollView>
  )

  if (session === 'unavailable') {
    return frame(
      <View testID="guest-preview-session-unavailable" style={{ gap: 12 }}>
        <Text accessibilityRole="alert" style={{ color: palette.ink }}>
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
        style={{ color: palette.inkMuted }}
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
        expired={previewExpired}
        onEligible={(birthdate) => {
          mobileGuestPreviewBirthdate.remember(store.start(), birthdate)
          setPreviewExpired(false)
          guestPreviewAnalytics.started()
        }}
        onExit={() => {
          mobileGuestPreviewBirthdate.clear()
          router.replace('/')
        }}
      />
    )
  }

  const input = toSampleSelectionInput(state)
  const view = state.view
  const lookId = result.look?.id
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
    if (!lookId || result.garments.some((garment) => garment.id === garmentId)) return
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
  const convert = (action: 'create_account' | 'sign_in', saveLook: boolean) => {
    const next = update((current) =>
      saveLook
        ? beginGuestLookSave(current, result)
        : {
            ...current,
            conversion: { intent: GUEST_PREVIEW_GARMENT_INTENT },
          }
    )
    setSavePreviewStartedAt(null)
    if (!next) {
      mobileGuestPreviewBirthdate.clear()
      setPreviewExpired(true)
      return
    }
    if (saveLook && next.conversion?.intent !== GUEST_PREVIEW_SAVE_INTENT) return
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
          style={{ color: palette.noticeInk }}
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
              aria-selected={selected}
              onPress={() => navigate(tab.view)}
              style={[
                previewStyles.tab,
                selected
                  ? { backgroundColor: palette.inverse, borderColor: palette.inverse }
                  : { borderColor: palette.lineStrong },
              ]}
            >
              <Text
                style={{
                  color: selected ? palette.onInverse : palette.ink,
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
        <>
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
          <PreviewConversion
            strings={strings}
            palette={palette}
            onCreateAccount={() => convert('create_account', false)}
            onSignIn={() => convert('sign_in', false)}
          />
        </>
      ) : (
        <>
          <PreviewOutfit
            result={result}
            strings={strings}
            locale={locale}
            palette={palette}
            noAlternative={noAlternative}
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
            swapCategory={swapCategory}
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
            shuffleLabel={strings.firstRun.shuffle}
            saveAction={
              <PreviewButton
                buttonRef={saveInvoker}
                label={strings.firstRun.save}
                onPress={() => setSavePreviewStartedAt(state.startedAt)}
                testID="sample-save-look"
                palette={palette}
                primary
              />
            }
            mood={
              <StyleMoodRow
                selected={state.preferences?.style}
                onSelect={(style) =>
                  update((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      style: current.preferences?.style === style ? undefined : style,
                    },
                    selectedLookId: undefined,
                  }))
                }
              />
            }
          />
          <GuestStyleChoices
            labels={strings.styleIdeas}
            palette={palette}
            preferences={state.preferences}
            onPreferences={(preferences) =>
              update((current) => ({
                ...current,
                preferences,
                selectedLookId: undefined,
              }))
            }
          />
        </>
      )}
      {view !== 'wardrobe' && (
        <PreviewButton
          label={strings.firstRun.optionalComfort}
          onPress={() => setComfortExpanded((expanded) => !expanded)}
          testID="guest-preview-comfort-toggle"
          palette={palette}
          expanded={comfortExpanded}
        />
      )}
      {view !== 'wardrobe' && comfortExpanded && (
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
      )}
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
          mobileGuestPreviewBirthdate.clear()
          store.clear()
          router.replace('/')
        }}
        testID="guest-preview-exit"
        palette={palette}
      />
      <PreviewSheet
        visible={savePreviewStartedAt === state.startedAt}
        title={strings.firstRun.saveTitle}
        description={strings.firstRun.saveBody}
        strings={strings}
        palette={palette}
        returnFocusRef={saveInvoker}
        onClose={() => setSavePreviewStartedAt(null)}
        testID="guest-preview-save-sheet"
      >
        <PreviewButton
          label={strings.chrome.createAccount}
          onPress={() => convert('create_account', true)}
          testID="guest-preview-create-account"
          palette={palette}
          primary
        />
        <PreviewButton
          label={strings.chrome.signIn}
          onPress={() => convert('sign_in', true)}
          testID="guest-preview-sign-in"
          palette={palette}
        />
        <PreviewButton
          label={strings.firstRun.cancel}
          onPress={() => setSavePreviewStartedAt(null)}
          testID="guest-preview-save-cancel"
          palette={palette}
        />
      </PreviewSheet>
      <PreviewSwapSheet
        category={swapCategory}
        {...sampleOutfitSwapOptions(result, swapCategory)}
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
