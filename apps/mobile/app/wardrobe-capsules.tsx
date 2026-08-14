import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type {
  CapsuleOccasion,
  CreateOutfitCapsuleInput,
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'
import {
  MobileCapsuleBuilderModal,
  type MobileCapsuleSaveOptions,
} from '@/components/wardrobe/capsule-builder-modal'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import {
  capsuleETag,
  createCapsuleFromMobile,
  deleteCapsuleFromMobile,
  favoriteCapsuleFromMobile,
  listCapsulesFromMobile,
  listGarmentsFromMobile,
  resolveOwnerUserId,
  updateCapsuleFromMobile,
} from '@/src/lib/wardrobe'

const SEARCH_DEBOUNCE_MS = 250

const OCCASION_FILTERS: (CapsuleOccasion | 'all')[] = [
  'all',
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
]

/**
 * Mobile capsule management: list, search, filter, create, edit, favorite,
 * repair, and delete.
 *
 * The builder component previously existed with no caller at all, so none of
 * these flows were reachable on mobile.
 */
export default function WardrobeCapsulesScreen() {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [capsules, setCapsules] = useState<OutfitCapsuleContract[]>([])
  const [total, setTotal] = useState(0)
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [occasionFilter, setOccasionFilter] = useState<CapsuleOccasion | 'all'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [editingCapsule, setEditingCapsule] = useState<OutfitCapsuleContract | null>(null)
  const [createNodeHandle, setCreateNodeHandle] = useState<number | null>(null)

  const inFlightRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await resolveMobileAccessToken()
      if (cancelled) return
      if (!token) {
        setErrorMessage('Sign in to manage capsules.')
        setIsLoading(false)
        return
      }
      setAccessToken(token)
      try {
        setOwnerUserId(resolveOwnerUserId(token))
      } catch (error: unknown) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Sign in to manage capsules.'
        )
        setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Debounce keystrokes into one query instead of a request per character. */
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadCapsules = useCallback(async () => {
    if (!accessToken || !ownerUserId) {
      return
    }

    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller

    setIsLoading(true)
    setErrorMessage(null)
    try {
      const [page, garmentList] = await Promise.all([
        listCapsulesFromMobile(
          accessToken,
          ownerUserId,
          {
            limit: 20,
            offset: 0,
            q: searchQuery || undefined,
            occasion: occasionFilter !== 'all' ? occasionFilter : undefined,
            isFavorite: favoriteOnly ? true : undefined,
          },
          controller.signal
        ),
        listGarmentsFromMobile(accessToken, controller.signal),
      ])
      if (controller.signal.aborted) return
      setCapsules(page.items)
      setTotal(page.total)
      setGarments(garmentList)
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      setErrorMessage(
        error instanceof Error ? error.message : t('wardrobe.capsules.errors.load')
      )
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [accessToken, ownerUserId, searchQuery, occasionFilter, favoriteOnly])

  useEffect(() => {
    void loadCapsules()
  }, [loadCapsules])

  useEffect(() => () => inFlightRef.current?.abort(), [])

  const handleSave = async (
    input: CreateOutfitCapsuleInput,
    options: MobileCapsuleSaveOptions
  ) => {
    if (editingCapsule && options.ifMatch) {
      await updateCapsuleFromMobile(
        accessToken,
        ownerUserId,
        editingCapsule.id,
        input,
        options.ifMatch
      )
      setStatusMessage(t('wardrobe.capsules.updated'))
    } else {
      await createCapsuleFromMobile(
        accessToken,
        ownerUserId,
        input,
        options.idempotencyKey
      )
      setStatusMessage(t('wardrobe.capsules.created'))
    }
    await loadCapsules()
  }

  const handleToggleFavorite = async (capsule: OutfitCapsuleContract) => {
    try {
      await favoriteCapsuleFromMobile(
        accessToken,
        ownerUserId,
        capsule.id,
        !capsule.isFavorite,
        capsuleETag(capsule.id, capsule.revision)
      )
      setStatusMessage(t('wardrobe.capsules.favoriteUpdated'))
      await loadCapsules()
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : t('wardrobe.capsules.errors.save')
      )
    }
  }

  const confirmDelete = (capsule: OutfitCapsuleContract) => {
    Alert.alert(
      t('wardrobe.capsules.deleteConfirmTitle'),
      t('wardrobe.capsules.deleteConfirmBody'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('wardrobe.capsules.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteCapsuleFromMobile(
                  accessToken,
                  ownerUserId,
                  capsule.id,
                  capsuleETag(capsule.id, capsule.revision)
                )
                setStatusMessage(t('wardrobe.capsules.deleted'))
                await loadCapsules()
              } catch (error: unknown) {
                setErrorMessage(
                  error instanceof Error
                    ? error.message
                    : t('wardrobe.capsules.errors.delete')
                )
              }
            })()
          },
        },
      ]
    )
  }

  const hiddenCount = Math.max(0, total - capsules.length)

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('wardrobe.capsules.title') }} />

      {/* Polite status so success does not interrupt a screen reader mid-sentence. */}
      <Text
        accessibilityLiveRegion="polite"
        style={styles.visuallyHidden}
        testID="capsule-status-region"
      >
        {statusMessage ?? ''}
      </Text>

      <View style={styles.toolbar}>
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t('wardrobe.capsules.searchPlaceholder')}
          accessibilityLabel={t('wardrobe.capsules.searchLabel')}
          style={styles.searchInput}
          testID="capsule-search-input"
        />
        <Pressable
          // The ref is resolved through `safeFindNodeHandle`, never cast.
          //
          // This used to be `node as unknown as number`, which asserted to the
          // type system that a host component instance was a reactTag and then
          // stored it. `MobileCapsuleBuilderModal` feeds that value straight to
          // `AccessibilityInfo.setAccessibilityFocus`, so on close it crossed
          // the JSI bridge as a non-number and took the whole process down with
          // `Exception in HostFunction: Unsupported jsi::Value kind` -- no red
          // box, no recovery. It is the same defect as the eight raw
          // `findNodeHandle` call sites already routed through this helper; this
          // site was missed because it never called `findNodeHandle` at all.
          ref={(node) => {
            setCreateNodeHandle(safeFindNodeHandle(node))
          }}
          onPress={() => {
            setEditingCapsule(null)
            setIsBuilderOpen(true)
          }}
          accessibilityRole="button"
          accessibilityLabel={t('wardrobe.capsules.create')}
          style={styles.primaryButton}
          testID="create-capsule-button"
        >
          <Text style={styles.primaryButtonText}>{t('wardrobe.capsules.create')}</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {OCCASION_FILTERS.map((occasion) => {
          const selected = occasionFilter === occasion
          return (
            <Pressable
              key={occasion}
              onPress={() => setOccasionFilter(occasion)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={
                occasion === 'all'
                  ? t('wardrobe.capsules.filterAll')
                  : t(`wardrobe.capsules.occasions.${occasion}`)
              }
              style={[styles.filterChip, selected && styles.filterChipSelected]}
              testID={`capsule-occasion-filter-${occasion}`}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {occasion === 'all'
                  ? t('wardrobe.capsules.filterAll')
                  : t(`wardrobe.capsules.occasions.${occasion}`)}
              </Text>
            </Pressable>
          )
        })}
        <Pressable
          onPress={() => setFavoriteOnly((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: favoriteOnly }}
          accessibilityLabel={t('wardrobe.capsules.filterFavorites')}
          style={[styles.filterChip, favoriteOnly && styles.filterChipSelected]}
          testID="capsule-favorite-filter"
        >
          <Text style={[styles.filterText, favoriteOnly && styles.filterTextSelected]}>
            ★ {t('wardrobe.capsules.filterFavorites')}
          </Text>
        </Pressable>
      </ScrollView>

      {errorMessage && (
        <View
          style={styles.errorBox}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          testID="capsule-error-banner"
        >
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator style={styles.loader} testID="capsule-loading-state" />
      ) : capsules.length === 0 ? (
        <View style={styles.emptyState} testID="capsule-empty-state">
          <Text style={styles.emptyTitle}>{t('wardrobe.capsules.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('wardrobe.capsules.emptyBody')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {capsules.map((capsule) => (
            <View
              key={capsule.id}
              style={styles.card}
              testID={`capsule-card-${capsule.id}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{capsule.name}</Text>
                <Pressable
                  onPress={() => void handleToggleFavorite(capsule)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: capsule.isFavorite }}
                  accessibilityLabel={`${t('wardrobe.capsules.favoriteLabel')}: ${capsule.name}`}
                  style={styles.iconButton}
                  testID={`favorite-button-${capsule.id}`}
                >
                  <Text style={styles.iconText}>{capsule.isFavorite ? '★' : '☆'}</Text>
                </Pressable>
              </View>

              {capsule.description ? (
                <Text style={styles.cardBody}>{capsule.description}</Text>
              ) : null}

              <Text style={styles.cardMeta}>
                {capsule.garments.length} garments ·{' '}
                {capsule.availabilityStatus === 'ready' ? 'Ready' : 'Needs repair'}
              </Text>

              {capsule.unavailableGarmentCount > 0 && (
                <Text
                  style={styles.repairText}
                  testID={`capsule-unavailable-count-${capsule.id}`}
                >
                  {capsule.unavailableGarmentCount === 1
                    ? t('wardrobe.capsules.unavailableCount', {
                        count: capsule.unavailableGarmentCount,
                      })
                    : t('wardrobe.capsules.unavailableCount', {
                        count: capsule.unavailableGarmentCount,
                      })}
                </Text>
              )}

              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => {
                    setEditingCapsule(capsule)
                    setIsBuilderOpen(true)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('wardrobe.capsules.edit')}: ${capsule.name}`}
                  style={styles.secondaryButton}
                  testID={`edit-capsule-button-${capsule.id}`}
                >
                  <Text style={styles.secondaryButtonText}>
                    {t('wardrobe.capsules.edit')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(capsule)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('wardrobe.capsules.delete')}: ${capsule.name}`}
                  style={styles.destructiveButton}
                  testID={`delete-capsule-button-${capsule.id}`}
                >
                  <Text style={styles.destructiveButtonText}>
                    {t('wardrobe.capsules.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}

          {hiddenCount > 0 && (
            <Text style={styles.truncation} testID="capsule-truncation-notice">
              Showing {capsules.length} of {total}. Refine your search to see the rest.
            </Text>
          )}
        </ScrollView>
      )}

      <MobileCapsuleBuilderModal
        visible={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onSave={handleSave}
        availableGarments={garments}
        initialCapsule={editingCapsule}
        invokingNodeHandle={createNodeHandle}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#ffffff', flex: 1 },
  visuallyHidden: { height: 0, opacity: 0, width: 0 },
  toolbar: { flexDirection: 'row', gap: 12, padding: 16 },
  searchInput: {
    borderColor: '#d4d4d8',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '600' },
  filterRow: { gap: 8, paddingBottom: 8, paddingHorizontal: 16 },
  filterChip: {
    alignItems: 'center',
    borderColor: '#d4d4d8',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
  },
  filterChipSelected: { backgroundColor: '#18181b', borderColor: '#18181b' },
  filterText: { color: '#3f3f46', fontSize: 13, textTransform: 'capitalize' },
  filterTextSelected: { color: '#ffffff' },
  errorBox: { backgroundColor: '#fee2e2', margin: 16, padding: 12 },
  errorText: { color: '#991b1b', fontSize: 13 },
  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#71717a', marginTop: 4, textAlign: 'center' },
  list: { gap: 12, padding: 16 },
  card: {
    borderColor: '#e4e4e7',
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  cardBody: { color: '#52525b', fontSize: 13 },
  cardMeta: { color: '#71717a', fontSize: 12 },
  repairText: { color: '#b45309', fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  iconText: { color: '#eab308', fontSize: 20 },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#d4d4d8',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#3f3f46', fontSize: 13 },
  destructiveButton: {
    alignItems: 'center',
    borderColor: '#fecaca',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
  },
  destructiveButtonText: { color: '#dc2626', fontSize: 13 },
  truncation: { color: '#71717a', fontSize: 12, textAlign: 'center' },
})
