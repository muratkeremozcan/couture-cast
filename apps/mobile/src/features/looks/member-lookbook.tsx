import { requestLookIdeas, withRequestDeadline } from '@couture/api-client'
import {
  resolveSupportedLocale,
  ritualResponseSchema,
  type SavedLookContract,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import {
  buildHomeSampleSavedLookInput,
  canShuffleMemberLookbook,
  createIdempotencyKey,
  createMemberLookbook,
  createMemberLookbookRanking,
  getGuestPreviewStrings,
  getMemberLookbookStrings,
  getStyleProfileStrings,
  isMemberLookbookDraftEdited,
  memberLookbookDraftKey,
  memberLookbookOutfitDraft,
  memberLookbookRankingCandidates,
  memberLookbookRankingInput,
  memberLookbookWeatherReason,
  presentMemberLookbookRanking,
  readMemberLookbookDraft,
  resolveMemberLookbookDraft,
  sampleGarmentText,
  sampleLookText,
  shuffleMemberLookbook,
  styleForecastSampleWeather,
  validateMemberLookbookRanking,
  type MemberLookbookDraft,
  type MemberLookbookRankingInput,
  type SampleWeatherKey,
} from '@couture/utils'
import { router, useFocusEffect } from 'expo-router'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SaveActionButton } from '@/components/save-feedback'
import { createMobileApiClient } from '@/src/lib/api-client'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'
import {
  sampleRecipeStorage,
  type SampleRecipeStorageHandle,
} from '@/src/lib/sample-recipe-storage'
import type { useMobileStyleProfile } from '@/src/lib/style-profile'
import { useTokens } from '@/src/theme/tokens'
import { PreviewButton, SampleGarmentArt } from '../preview/guest-preview-parts'
import { StyleDayControls } from '../preview/style-profile-controls'
import { savedLookRoute } from './looks-routes'

const MAX_SAVE_ATTEMPTS = 32
type SaveAttempt = {
  idempotencyKey: string
  receipt?: Pick<SavedLookContract, 'id' | 'revision'>
}

function useLookbookForecast(locale: SupportedLocale, isCurrent: () => boolean) {
  const [weather, setWeather] = useState<SampleWeatherKey>()
  useFocusEffect(
    useCallback(() => {
      let active: AbortController | undefined
      const refresh = () => {
        active?.abort()
        const request = new AbortController()
        active = request
        const live = () => !request.signal.aborted && isCurrent()
        const read = async () => {
          const accessToken = await resolveMobileAccessToken()
          if (!accessToken || !live()) throw new Error('Lookbook session changed.')
          const api = createMobileApiClient({ accessToken })
          const response = await withRequestDeadline(15_000, [request.signal], (signal) =>
            api.apiV1RitualGet({ locale }, { signal })
          )
          return styleForecastSampleWeather(
            ritualResponseSchema.parse(response).data.weather.current
          )
        }
        void read().then(
          (next) => {
            if (live()) setWeather(next)
          },
          () => {
            if (live()) setWeather('mild-dry')
          }
        )
      }
      refresh()
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh()
        else active?.abort()
      })
      return () => {
        active?.abort()
        appState.remove()
      }
    }, [isCurrent, locale])
  )
  return weather
}

function Choice({
  id,
  label,
  accessibilityLabel,
  selected,
  disabled,
  onPress,
  pill,
}: {
  id: string
  label: string
  accessibilityLabel?: string
  selected: boolean
  disabled: boolean
  onPress: () => void
  pill?: boolean
}) {
  const { colors, fontWeight, radius, shell, space, type } = useTokens()
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        pill && styles.moodChoice,
        {
          minHeight: shell.touchTarget,
          borderRadius: pill ? radius.full : radius.md,
          paddingHorizontal: space[3],
          backgroundColor: selected ? colors.inverse : colors.page,
          borderColor: selected ? colors.inverse : colors.lineStrong,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? colors.onInverse : colors.ink,
          fontSize: type.sm.fontSize,
          fontWeight: fontWeight.semibold,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function useLookbookIdeas(
  weather: SampleWeatherKey | undefined,
  style: ReturnType<typeof useMobileStyleProfile>,
  draft: MemberLookbookDraft | null | undefined,
  isCurrent: () => boolean
) {
  const { profile, day, status } = style
  // Equivalent weather and profile reads share one request identity.
  const inputKey = JSON.stringify(
    memberLookbookRankingInput(weather ?? 'mild-dry', { profile, day })
  )
  const input = useMemo(
    () => JSON.parse(inputKey) as MemberLookbookRankingInput,
    [inputKey]
  )
  const ideas = useMemo(() => createMemberLookbook(input.weather, input), [input])
  const [stylist] = useState(createMemberLookbookRanking)
  const requestKey =
    draft !== undefined && weather && (status === 'ready' || status === 'failed')
      ? inputKey
      : null
  const ranking = useSyncExternalStore(stylist.subscribe, stylist.read)
  useLayoutEffect(() => {
    if (draft) stylist.markEdited()
  }, [draft, stylist])
  useLayoutEffect(() => {
    if (!requestKey) return
    return stylist.request(requestKey, isCurrent, async (signal) => {
      const accessToken = await resolveMobileAccessToken()
      if (!accessToken || signal.aborted || !isCurrent()) return null
      const data = await requestLookIdeas(
        createMobileApiClient({ accessToken }),
        input,
        signal
      )
      return validateMemberLookbookRanking(
        data,
        memberLookbookRankingCandidates(ideas),
        input.weather
      )
    })
  }, [ideas, input, isCurrent, requestKey, stylist])

  const currentRanking =
    ranking && ranking.key === requestKey && isCurrent() ? ranking : null
  return {
    ...presentMemberLookbookRanking(ideas, draft?.mood, currentRanking),
    markEdited: stylist.markEdited,
    apply: () => stylist.apply(currentRanking, isCurrent),
  }
}

export function MemberLookbook({
  owner,
  epoch,
  style,
}: {
  owner: string
  epoch: number
  style: ReturnType<typeof useMobileStyleProfile>
}) {
  const { i18n } = useTranslation()
  const { colors, fontWeight, radius, space, type } = useTokens()
  const { fontScale, width } = useWindowDimensions()
  const language = i18n.resolvedLanguage ?? i18n.language
  const locale = resolveSupportedLocale(language) ?? 'en-US'
  const strings = getGuestPreviewStrings(locale)
  const copy = getMemberLookbookStrings(locale)
  const styleCopy = getStyleProfileStrings(locale)
  const mounted = useRef(false)
  const isCurrent = useCallback(
    () =>
      mounted.current &&
      mobileApplicationUserId() === owner &&
      mobileIdentityEpoch() === epoch,
    [epoch, owner]
  )
  const weather = useLookbookForecast(locale, isCurrent)
  const storage = useRef<SampleRecipeStorageHandle | null>(null)
  const draftRef = useRef<MemberLookbookDraft | null>(null)
  const [draft, setDraft] = useState<MemberLookbookDraft | null>()
  const [mutating, setMutating] = useState(false)
  const activeMutation = useRef<AbortController | null>(null)
  const attempts = useRef(new Map<string, SaveAttempt>())

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      activeMutation.current?.abort()
      activeMutation.current = null
    }
  }, [epoch, owner])
  useEffect(() => {
    let active = true
    void sampleRecipeStorage(memberLookbookDraftKey(owner))
      .catch(() => null)
      .then((handle) => {
        if (!active || !isCurrent()) return
        storage.current = handle
        const restored = readMemberLookbookDraft(handle?.read() ?? null)
        draftRef.current = restored
        setDraft(restored)
      })
    return () => {
      active = false
      storage.current = null
    }
  }, [isCurrent, owner])

  const {
    orderedIdeas,
    selected: choice,
    pending: newIdeas,
    description,
    markEdited,
    apply,
  } = useLookbookIdeas(weather, style, draft, isCurrent)
  if (!choice) return null
  const { mood, result: base } = choice
  const { result, pinned } = resolveMemberLookbookDraft(base, draft?.looks[mood])
  const payload = buildHomeSampleSavedLookInput(result)
  const signature = JSON.stringify(payload)
  const canShuffle = canShuffleMemberLookbook(result, pinned)
  const edited = isMemberLookbookDraftEdited(base, result, pinned)
  const busy = mutating || draft === undefined
  const singleColumn = fontScale >= 1.5 && width <= 400

  const commit = (next: MemberLookbookDraft) => {
    if (!isCurrent()) return
    markEdited()
    draftRef.current = next
    storage.current?.write(JSON.stringify(next))
    setDraft(next)
  }
  const updateLook = (outfit: typeof result, pins: typeof pinned) => {
    markEdited()
    const looks = { ...draftRef.current?.looks }
    if (isMemberLookbookDraftEdited(base, outfit, pins)) {
      looks[mood] = memberLookbookOutfitDraft(outfit, pins)
    } else {
      if (!looks[mood]) return
      delete looks[mood]
    }
    commit({ mood, looks })
  }

  const live = (signal: AbortSignal) => !signal.aborted && isCurrent()

  async function runMutation<T>(
    perform: (accessToken: string, signal: AbortSignal) => Promise<T>
  ): Promise<T | false> {
    if (!isCurrent() || activeMutation.current) return false
    markEdited()
    const request = new AbortController()
    const { signal } = request
    activeMutation.current = request
    setMutating(true)
    try {
      const accessToken = await resolveMobileAccessToken()
      if (!accessToken || !live(signal)) return false
      return await perform(accessToken, signal)
    } finally {
      if (activeMutation.current === request) activeMutation.current = null
      if (live(signal)) setMutating(false)
    }
  }

  const onSave = () => {
    if (!payload) return false
    return runMutation(async (accessToken, signal) => {
      const attempt = attempts.current.get(signature) ?? {
        idempotencyKey: createIdempotencyKey(),
      }
      const alreadySaved = Boolean(attempt.receipt)
      attempts.current.delete(signature)
      attempts.current.set(signature, attempt)
      if (attempts.current.size > MAX_SAVE_ATTEMPTS) {
        attempts.current.delete(attempts.current.keys().next().value!)
      }
      try {
        const { id, revision } = await createSavedLookFromMobile(payload, {
          accessToken,
          idempotencyKey: attempt.idempotencyKey,
          signal,
        })
        if (!live(signal)) return false
        attempt.receipt = { id, revision }
        updateLook(result, [])
        notifyMobileSavedLooksChanged(owner)
        return { saved: true, undoable: !alreadySaved }
      } catch (error) {
        if (
          live(signal) &&
          error instanceof MobileSavedLookRequestError &&
          error.status === 409
        ) {
          attempts.current.delete(signature)
        }
        throw error
      }
    })
  }

  const onUndo = () => {
    const receipt = attempts.current.get(signature)?.receipt
    if (!receipt) return false
    return runMutation(async (accessToken, signal) => {
      try {
        const { id, revision } = receipt
        await deleteSavedLookFromMobile(id, formatSavedLookIfMatch(id, revision), {
          accessToken,
          signal,
        })
      } catch (error) {
        if (!(error instanceof MobileSavedLookRequestError && error.status === 404))
          throw error
      }
      if (!live(signal)) return false
      attempts.current.delete(signature)
      notifyMobileSavedLooksChanged(owner)
      return true
    })
  }

  return (
    <View testID="member-lookbook" style={{ gap: space[3] }}>
      <View
        role="group"
        testID="lookbook-mood-row"
        accessibilityLabel={styleCopy.mood}
        style={[styles.moodRow, { gap: space[2] }]}
      >
        {orderedIdeas.map(({ mood: value }) => (
          <Choice
            key={value}
            id={`lookbook-mood-${value}`}
            label={styleCopy[value]}
            selected={mood === value}
            disabled={busy}
            pill
            onPress={() => {
              if (!activeMutation.current && value !== mood)
                commit({ mood: value, looks: draftRef.current?.looks ?? {} })
            }}
          />
        ))}
      </View>

      <View
        testID="looks-idea-card-current"
        style={[
          styles.outfit,
          {
            borderColor: colors.line,
            borderRadius: radius.lg,
            gap: space[3],
            padding: space[3],
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: colors.ink,
            fontSize: type.xl.fontSize,
            fontWeight: fontWeight.semibold,
          }}
        >
          {result.look
            ? sampleLookText(result.look, strings).name
            : strings.firstUse.outfitIdea}
        </Text>
        <Text
          testID="lookbook-weather-reason"
          style={{ color: colors.inkMuted, fontSize: type.sm.fontSize }}
        >
          {memberLookbookWeatherReason(result, locale)}
        </Text>
        {description && (
          <Text
            testID="lookbook-ai-description"
            accessibilityLanguage="en"
            style={{ color: colors.inkMuted, fontSize: type.sm.fontSize }}
          >
            {description}
          </Text>
        )}

        <View style={[styles.rows, { gap: space[2] }]}>
          {result.garments.map((garment) => {
            const { category } = garment
            const isPinned = pinned.includes(category)
            const name = sampleGarmentText(garment, strings).name
            return (
              <View
                key={category}
                testID={`lookbook-piece-${category}`}
                style={[
                  styles.piece,
                  { width: singleColumn ? '100%' : '48%', gap: space[1] },
                ]}
              >
                <SampleGarmentArt garment={garment} size={58} />
                <Text
                  style={{
                    color: colors.ink,
                    fontSize: type.sm.fontSize,
                    textAlign: 'center',
                  }}
                >
                  {name}
                </Text>
                <Choice
                  id={`lookbook-pin-${category}`}
                  label={copy.pin}
                  accessibilityLabel={`${copy.pin}: ${name}`}
                  selected={isPinned}
                  disabled={busy}
                  onPress={() => {
                    if (activeMutation.current) return
                    updateLook(
                      result,
                      isPinned
                        ? pinned.filter((value) => value !== category)
                        : [...pinned, category]
                    )
                  }}
                />
              </View>
            )
          })}
        </View>

        <View style={[styles.rows, { gap: space[2] }]}>
          <PreviewButton
            testID="lookbook-shuffle"
            label={strings.firstRun.shuffle}
            palette={colors}
            disabled={busy || !canShuffle}
            onPress={() => {
              if (!activeMutation.current)
                updateLook(shuffleMemberLookbook(result, pinned), pinned)
            }}
          />
          <PreviewButton
            testID="lookbook-reset"
            label={copy.reset}
            palette={colors}
            disabled={busy || !edited}
            onPress={() => {
              if (!activeMutation.current && edited) updateLook(base, [])
            }}
          />
        </View>
        <StyleDayControls
          style={style}
          showMood={false}
          disabled={busy}
          onInteract={markEdited}
        />
        {newIdeas && (
          <PreviewButton
            testID="lookbook-new-ideas"
            label={copy.newIdeas}
            palette={colors}
            disabled={busy}
            onPress={apply}
          />
        )}
      </View>

      <SaveActionButton
        testID="lookbook-save"
        idleLabel={strings.firstRun.save}
        primary
        requiresNetwork
        disabled={!payload || busy}
        ownerKey={style.scope}
        resetKey={signature}
        onSave={onSave}
        onUndo={onUndo}
        onView={() => {
          const receipt = attempts.current.get(signature)?.receipt
          if (isCurrent() && receipt) router.push(savedLookRoute(receipt.id))
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  choice: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  moodChoice: { flex: 1, minWidth: 0 },
  moodRow: { flexDirection: 'row' },
  outfit: { borderWidth: 1 },
  rows: { flexDirection: 'row', flexWrap: 'wrap' },
  piece: { alignItems: 'center' },
})
