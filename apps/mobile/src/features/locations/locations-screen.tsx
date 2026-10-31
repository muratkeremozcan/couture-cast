// Story 1.2b mobile owner: the Locations screen in `apps/mobile/src/features/locations/locations-screen.tsx` and `onLocationsChanged` in `apps/mobile/src/lib/locations.ts`
// Story 1.2b owner: the mobile Locations screen, pushed from Settings and from
// the hero and Community no-location states.
//
// Lists saved locations (label, place, primary marker), adds through city
// search, and switches primary in one tap, renames and deletes in place. Every
// target is at least 44 points. Outcomes and search, save and list-action
// errors are announced once through the shared announcer; only the list load
// error uses the alert role. Busy actions set `aria-busy` beside
// `accessibilityState.busy`, which react-native-web 0.21 no longer renders.
// Opened from a guided entry, a save returns to the originating screen, which
// reloads on `onLocationsChanged`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  resolveSupportedLocale,
  type LocationSearchCandidate,
  type SavedLocation,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  deleteLocationFromMobile,
  listLocationsFromMobile,
  locationFailureReason,
  renameLocationFromMobile,
  saveLocationFromSearchFromMobile,
  searchLocationsFromMobile,
  setPrimaryLocationFromMobile,
  type LocationFailureReason,
} from '@/src/lib/locations'

/** Story 1.2b: search waits for 300 ms of quiet typing. */
export const LOCATION_SEARCH_DEBOUNCE_MS = 300
export const MAX_SAVED_LOCATIONS = 3
const MIN_QUERY_LENGTH = 2

type ScreenState = 'loading' | 'ready' | 'signed_out' | 'load_failed'

/** Which request failed: the same provider outage reads differently on save. */
export type LocationFailureStep = 'search' | 'save'

export function errorKey(
  reason: LocationFailureReason,
  step: LocationFailureStep = 'search'
): string {
  switch (reason) {
    case 'provider_unavailable':
      // The save-time forecast is a different request from city search, and
      // telling the member search is down when their pick could not be saved
      // sends them to the wrong fix.
      return step === 'save'
        ? 'locations.errors.save_unavailable'
        : 'locations.errors.provider_unavailable'
    case 'service_unavailable':
    case 'invalid_candidate':
    case 'duplicate':
    case 'rate_limited':
    case 'invalid_query':
      return `locations.errors.${reason}`
    case 'limit_reached':
      return 'locations.limit'
    default:
      return 'locations.errors.unknown'
  }
}

/** City, region and country name in the reader's language, each said once. */
export function formatPlace(
  location: Pick<SavedLocation, 'city' | 'region' | 'country'>,
  locale: string
): string {
  let country = location.country
  if (country) {
    try {
      country = new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
    } catch {
      // A legacy free-text country stays as typed.
    }
  }
  const seen = new Set<string>()
  return [location.city, location.region, country]
    .filter((part): part is string => {
      if (!part) return false
      const key = part.trim().toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
}

export interface LocationsScreenProps {
  /** Opened from a no-location state: save returns there. */
  guided?: boolean
}

export function LocationsScreen({ guided = false }: LocationsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  const { announce } = useAccessibilityAnnouncer()
  const locale = resolveSupportedLocale(i18n.language) ?? 'en-US'
  const [screenState, setScreenState] = useState<ScreenState>('loading')
  const [locations, setLocations] = useState<SavedLocation[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [listError, setListError] = useState<LocationFailureReason | null>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<LocationSearchCandidate[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [selected, setSelected] = useState<LocationSearchCandidate | null>(null)
  const [label, setLabel] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<{
    reason: LocationFailureReason
    step: LocationFailureStep
  } | null>(null)
  const headingRef = useRef<Text>(null)
  const announceRef = useRef(announce)
  announceRef.current = announce
  const tRef = useRef(t)
  tRef.current = t

  const focus = useCallback((node: unknown) => {
    const handle = safeFindNodeHandle(node)
    if (handle !== null && Platform.OS !== 'web') {
      AccessibilityInfo.setAccessibilityFocus(handle)
    }
  }, [])

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await listLocationsFromMobile(signal)
    if (signal?.aborted) return
    setLocations(next)
    setScreenState('ready')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setScreenState(
        locationFailureReason(error) === 'signed_out' ? 'signed_out' : 'load_failed'
      )
    })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH || selected) {
      setCandidates([])
      setIsSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setIsSearching(true)
      searchLocationsFromMobile(trimmed, locale, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return
          setCandidates(results)
          // A refused save stays explained while the query searches again.
          setFormError((current) => (current?.step === 'save' ? current : null))
          announceRef.current(
            'feedback',
            results.length > 0
              ? tRef.current('locations.resultCount', { count: results.length })
              : tRef.current('locations.noResults')
          )
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setCandidates([])
          const reason = locationFailureReason(error)
          setFormError({ reason, step: 'search' })
          announceRef.current('error', tRef.current(errorKey(reason, 'search')))
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false)
        })
    }, LOCATION_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, locale, selected, searchAttempt])

  async function runListAction(
    locationId: string,
    work: () => Promise<string>
  ): Promise<void> {
    if (busyId) return
    setBusyId(locationId)
    setListError(null)
    try {
      const message = await work()
      await reload()
      announce('feedback', message)
    } catch (error) {
      const reason = locationFailureReason(error)
      setListError(reason)
      announce('error', t(errorKey(reason)))
    } finally {
      setBusyId(null)
    }
  }

  function choose(candidate: LocationSearchCandidate) {
    setSelected(candidate)
    setLabel(candidate.city)
    setCandidates([])
    setFormError(null)
    announce('feedback', t('locations.selected', { place: candidate.displayLabel }))
  }

  async function save() {
    if (isSaving || !selected) return
    setIsSaving(true)
    setFormError(null)
    try {
      const saved = await saveLocationFromSearchFromMobile(
        selected.candidateToken,
        label.trim() || selected.city
      )
      setSelected(null)
      setQuery('')
      setLabel('')
      announce('feedback', t('locations.saved', { label: saved.label }))
      if (guided && router.canGoBack()) {
        router.back()
        return
      }
      await reload()
    } catch (error) {
      const reason = locationFailureReason(error)
      if (reason === 'invalid_candidate') setSelected(null)
      setFormError({ reason, step: 'save' })
      announce('error', t(errorKey(reason, 'save')))
    } finally {
      setIsSaving(false)
    }
  }

  const textStyle = { color: palette.text }
  const mutedStyle = { color: palette.mutedText }
  const inputStyle = [styles.input, { color: palette.text, borderColor: palette.divider }]
  const isFull = locations.length >= MAX_SAVED_LOCATIONS
  const canRetry =
    formError?.reason === 'provider_unavailable' ||
    formError?.reason === 'service_unavailable'

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      testID="locations-screen"
    >
      {/* The native header carries the title; this screen renders no second one. */}
      <Text ref={headingRef} style={[styles.body, mutedStyle]}>
        {t('locations.intro')}
      </Text>

      {screenState === 'loading' && (
        <ActivityIndicator
          accessibilityLabel={t('locations.title')}
          testID="locations-loading"
        />
      )}
      {screenState === 'signed_out' && (
        <Text style={[styles.body, mutedStyle]} testID="locations-signed-out">
          {t('locations.signedOutHint')}
        </Text>
      )}
      {screenState === 'load_failed' && (
        <Text
          accessibilityRole="alert"
          style={[styles.body, { color: palette.danger }]}
          testID="locations-load-error"
        >
          {t('locations.loadError')}
        </Text>
      )}

      {screenState === 'ready' && (
        <>
          <Text style={[styles.body, mutedStyle]} testID="locations-count">
            {t('locations.count', { count: locations.length })}
          </Text>
          {locations.length === 0 && (
            <Text style={[styles.body, textStyle]} testID="locations-empty">
              {t('locations.empty')}
            </Text>
          )}
          {locations.map((location, index) => (
            <View
              key={location.id}
              style={[styles.card, { borderColor: palette.divider }]}
              testID={`location-item-${index}`}
            >
              <View style={styles.cardHeader}>
                <Text
                  style={[styles.cardTitle, textStyle]}
                  testID={`location-label-${index}`}
                >
                  {location.label}
                </Text>
                {location.isPrimary && (
                  <Text style={styles.badge} testID={`location-primary-badge-${index}`}>
                    {t('locations.primary')}
                  </Text>
                )}
              </View>
              <Text style={mutedStyle}>{formatPlace(location, locale)}</Text>

              {renamingId === location.id ? (
                <View style={styles.row}>
                  <TextInput
                    autoFocus
                    accessibilityLabel={t('locations.renameField')}
                    value={renameValue}
                    maxLength={80}
                    onChangeText={setRenameValue}
                    style={[inputStyle, styles.flex]}
                    testID={`location-rename-input-${index}`}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: busyId === location.id }}
                    aria-busy={busyId === location.id}
                    onPress={() => {
                      const next = renameValue.trim()
                      if (!next) return
                      void runListAction(location.id, async () => {
                        await renameLocationFromMobile(location.id, next)
                        setRenamingId(null)
                        return t('locations.renamed', { label: next })
                      })
                    }}
                    style={styles.primaryButton}
                    testID={`location-rename-save-${index}`}
                  >
                    <Text style={styles.primaryButtonText}>
                      {t('locations.renameSave')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setRenamingId(null)}
                    style={[styles.secondaryButton, { borderColor: palette.divider }]}
                  >
                    <Text style={textStyle}>{t('locations.cancel')}</Text>
                  </Pressable>
                </View>
              ) : confirmingId === location.id ? (
                <View style={styles.row}>
                  <Text style={[textStyle, styles.flex]}>
                    {t('locations.deleteConfirm', { label: location.label })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: busyId === location.id }}
                    aria-busy={busyId === location.id}
                    onPress={() => {
                      void runListAction(location.id, async () => {
                        await deleteLocationFromMobile(location.id)
                        setConfirmingId(null)
                        return t('locations.deleted', { label: location.label })
                      }).then(() => focus(headingRef.current))
                    }}
                    style={[styles.secondaryButton, { borderColor: palette.danger }]}
                    testID="location-delete-confirm"
                  >
                    <Text style={{ color: palette.danger }}>
                      {t('locations.deleteConfirmAction')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setConfirmingId(null)}
                    style={[styles.secondaryButton, { borderColor: palette.divider }]}
                  >
                    <Text style={textStyle}>{t('locations.cancel')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.row}>
                  {!location.isPrimary && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t('locations.makePrimary')}, ${location.label}`}
                      accessibilityState={{ busy: busyId === location.id }}
                      aria-busy={busyId === location.id}
                      onPress={() => {
                        void runListAction(location.id, async () => {
                          await setPrimaryLocationFromMobile(location.id)
                          return t('locations.primaryChanged', { label: location.label })
                        })
                      }}
                      style={[styles.secondaryButton, { borderColor: '#C9A14A' }]}
                      testID={`location-make-primary-${index}`}
                    >
                      <Text style={textStyle}>{t('locations.makePrimary')}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('locations.rename')}, ${location.label}`}
                    onPress={() => {
                      setConfirmingId(null)
                      setRenameValue(location.label)
                      setRenamingId(location.id)
                    }}
                    style={[styles.secondaryButton, { borderColor: palette.divider }]}
                    testID={`location-rename-${index}`}
                  >
                    <Text style={textStyle}>{t('locations.rename')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('locations.delete')}, ${location.label}`}
                    onPress={() => {
                      setRenamingId(null)
                      setConfirmingId(location.id)
                    }}
                    style={[styles.secondaryButton, { borderColor: palette.divider }]}
                    testID={`location-delete-${index}`}
                  >
                    <Text style={textStyle}>{t('locations.delete')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {/* Announced once through the announcer in runListAction; an alert
              role here would read it a second time. */}
          {listError && (
            <Text style={{ color: palette.danger }} testID="locations-list-error">
              {t(errorKey(listError))}
            </Text>
          )}

          {isFull ? (
            <Text style={[styles.body, textStyle]} testID="locations-limit">
              {t('locations.limit')}
            </Text>
          ) : (
            <View style={styles.form} testID="location-add-form">
              <Text style={[styles.label, textStyle]}>{t('locations.searchLabel')}</Text>
              <TextInput
                autoFocus={guided}
                accessibilityLabel={t('locations.searchLabel')}
                accessibilityHint={t('locations.searchHint')}
                autoCorrect={false}
                autoCapitalize="words"
                value={query}
                maxLength={80}
                onChangeText={(value) => {
                  setQuery(value)
                  setSelected(null)
                }}
                placeholder={t('locations.searchHint')}
                placeholderTextColor={palette.mutedText}
                style={inputStyle}
                testID="locations-search-input"
              />
              {isSearching && (
                <Text style={mutedStyle} testID="locations-searching">
                  {t('locations.searching')}
                </Text>
              )}
              {candidates.map((candidate, index) => (
                <Pressable
                  key={candidate.candidateToken}
                  accessibilityRole="button"
                  accessibilityLabel={candidate.displayLabel}
                  onPress={() => choose(candidate)}
                  style={[styles.option, { borderColor: palette.divider }]}
                  testID={`location-search-option-${index}`}
                >
                  <Text style={textStyle}>{candidate.displayLabel}</Text>
                </Pressable>
              ))}

              {selected && (
                <View style={styles.form} testID="location-selected">
                  <Text style={textStyle}>
                    {t('locations.selected', { place: selected.displayLabel })}
                  </Text>
                  <Text style={[styles.label, textStyle]}>
                    {t('locations.labelField')}
                  </Text>
                  <TextInput
                    accessibilityLabel={t('locations.labelField')}
                    value={label}
                    maxLength={80}
                    onChangeText={setLabel}
                    style={inputStyle}
                    testID="location-label-input"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: isSaving }}
                    aria-busy={isSaving}
                    onPress={() => {
                      void save()
                    }}
                    style={styles.primaryButton}
                    testID="location-save-button"
                  >
                    {isSaving ? (
                      <View style={styles.row}>
                        <ActivityIndicator color="#111111" />
                        <Text style={styles.primaryButtonText}>
                          {t('locations.saving')}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryButtonText}>{t('locations.save')}</Text>
                    )}
                  </Pressable>
                </View>
              )}

              {formError && (
                <View style={styles.form}>
                  {/* Announced once through the announcer by search and save;
                      an alert role here would read it a second time. */}
                  <Text style={{ color: palette.danger }} testID="location-error">
                    {t(errorKey(formError.reason, formError.step))}
                  </Text>
                  {canRetry && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (selected) {
                          void save()
                          return
                        }
                        setFormError(null)
                        setSearchAttempt((attempt) => attempt + 1)
                      }}
                      style={[styles.secondaryButton, { borderColor: palette.divider }]}
                      testID="location-retry-button"
                    >
                      <Text style={textStyle}>{t('locations.retry')}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12, paddingBottom: 48 },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  badge: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#C9A14A',
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  flex: { flexGrow: 1, flexShrink: 1 },
  form: { gap: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    // Gold with near-black text holds contrast on both the light and dark hero palettes.
    backgroundColor: '#C9A14A',
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: '#111111', fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
})
