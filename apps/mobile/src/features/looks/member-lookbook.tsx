import { withRequestDeadline } from '@couture/api-client'
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
  getGuestPreviewStrings,
  getMemberLookbookStrings,
  getStyleProfileStrings,
  memberLookbookDraftKey,
  memberLookbookOutfitDraft,
  memberLookbookWeatherReason,
  readMemberLookbookDraft,
  resolveMemberLookbookDraft,
  sampleGarmentText,
  sampleLookText,
  shuffleMemberLookbook,
  styleForecastSampleWeather,
  type MemberLookbookDraft,
  type SampleWeatherKey,
} from '@couture/utils'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
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
  const isCurrent = useCallback(
    () => mobileApplicationUserId() === owner && mobileIdentityEpoch() === epoch,
    [epoch, owner]
  )
  const weather = useLookbookForecast(locale, isCurrent)
  const storage = useRef<SampleRecipeStorageHandle | null>(null)
  const draftRef = useRef<MemberLookbookDraft | null>(null)
  const [draft, setDraft] = useState<MemberLookbookDraft | null>()
  const [saving, setSaving] = useState(false)
  const saveRequest = useRef<AbortController | null>(null)
  const attemptKeys = useRef(new Map<string, string>())
  const saved = useRef<{ record: SavedLookContract; signature: string } | null>(null)

  useLayoutEffect(() => () => saveRequest.current?.abort(), [])
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

  if (
    draft === undefined ||
    !weather ||
    style.status === 'idle' ||
    style.status === 'loading'
  )
    return <ActivityIndicator color={colors.ink} testID="lookbook-loading" />

  const ideas = createMemberLookbook(weather, { profile: style.profile, day: style.day })
  const choice = ideas.find(({ mood }) => mood === draft?.mood) ?? ideas[0]
  if (!choice) return null
  const { mood, result: base } = choice
  const { result, pinned } = resolveMemberLookbookDraft(base, draft?.looks[mood])
  const payload = buildHomeSampleSavedLookInput(result)
  const signature = JSON.stringify(payload)
  const canShuffle = canShuffleMemberLookbook(result, pinned)
  const singleColumn = fontScale >= 1.5 && width <= 400

  const commit = (next: MemberLookbookDraft) => {
    if (!isCurrent()) return
    draftRef.current = next
    storage.current?.write(JSON.stringify(next))
    setDraft(next)
  }
  const updateLook = (outfit: typeof result, pins: typeof pinned) => {
    commit({
      mood,
      looks: {
        ...draftRef.current?.looks,
        [mood]: memberLookbookOutfitDraft(outfit, pins),
      },
    })
  }

  const onSave = async () => {
    if (!payload || !isCurrent() || saveRequest.current) return false
    const request = new AbortController()
    saveRequest.current = request
    setSaving(true)
    const live = () => !request.signal.aborted && isCurrent()
    try {
      const accessToken = await resolveMobileAccessToken()
      if (!accessToken || !live()) return false
      const idempotencyKey = attemptKeys.current.get(signature) ?? createIdempotencyKey()
      attemptKeys.current.set(signature, idempotencyKey)
      if (attemptKeys.current.size > 32)
        attemptKeys.current.delete(attemptKeys.current.keys().next().value!)
      const record = await createSavedLookFromMobile(payload, {
        accessToken,
        idempotencyKey,
        signal: request.signal,
      })
      if (!live()) return false
      saved.current = { record, signature }
      updateLook(result, [])
      notifyMobileSavedLooksChanged(owner)
      return true
    } catch (error) {
      if (error instanceof MobileSavedLookRequestError && error.status === 409)
        attemptKeys.current.delete(signature)
      throw error
    } finally {
      saveRequest.current = null
      if (live()) setSaving(false)
    }
  }

  const onUndo = async () => {
    const entry = saved.current
    if (!entry || !isCurrent()) return false
    const { record } = entry
    const accessToken = await resolveMobileAccessToken()
    if (!accessToken || !isCurrent()) return false
    try {
      await deleteSavedLookFromMobile(
        record.id,
        formatSavedLookIfMatch(record.id, record.revision),
        { accessToken }
      )
    } catch (error) {
      if (!(error instanceof MobileSavedLookRequestError && error.status === 404))
        throw error
    }
    if (!isCurrent()) return false
    attemptKeys.current.delete(entry.signature)
    if (saved.current === entry) saved.current = null
    notifyMobileSavedLooksChanged(owner)
    return true
  }

  return (
    <View testID="member-lookbook" style={{ gap: space[3] }}>
      <View
        role="group"
        testID="lookbook-mood-row"
        accessibilityLabel={styleCopy.mood}
        style={[styles.moodRow, { gap: space[2] }]}
      >
        {ideas.map(({ mood: value }) => (
          <Choice
            key={value}
            id={`lookbook-mood-${value}`}
            label={styleCopy[value]}
            selected={mood === value}
            disabled={saving}
            pill
            onPress={() => {
              if (!saveRequest.current && value !== mood)
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
                  label={isPinned ? copy.unpin : copy.pin}
                  accessibilityLabel={`${copy.pin}: ${name}`}
                  selected={isPinned}
                  disabled={saving}
                  onPress={() => {
                    if (saveRequest.current) return
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
            disabled={saving || !canShuffle}
            onPress={() => {
              if (!saveRequest.current)
                updateLook(shuffleMemberLookbook(result, pinned), pinned)
            }}
          />
          <PreviewButton
            testID="lookbook-reset"
            label={copy.reset}
            palette={colors}
            disabled={saving || !draft?.looks[mood]}
            onPress={() => {
              if (saveRequest.current) return
              const looks = { ...draftRef.current?.looks }
              delete looks[mood]
              commit({ mood, looks })
            }}
          />
        </View>
        <StyleDayControls style={style} showMood={false} disabled={saving} />
      </View>

      <SaveActionButton
        testID="lookbook-save"
        idleLabel={strings.firstRun.save}
        primary
        requiresNetwork
        disabled={!payload}
        ownerKey={style.scope}
        resetKey={signature}
        onSave={onSave}
        onUndo={onUndo}
        onView={() => {
          if (isCurrent() && saved.current)
            router.push(savedLookRoute(saved.current.record.id))
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
