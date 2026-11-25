// Story 4.3 Task 6 step 2 owner: implement the mobile capsule screen in apps/mobile/app/wardrobe-capsules.tsx
import { WardrobeBackButton } from '@/src/features/wardrobe/wardrobe-back-button'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { createSchemeStyles, useSchemeColors } from '@/components/themed'
import {
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
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
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberCapsulesScreen key={epoch} epoch={epoch} />
}

function MemberCapsulesScreen({ epoch }: { epoch: number }) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const themed = useThemedStyles()
  const insets = useSafeAreaInsets()
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
  const mountRef = useRef<AbortController | null>(null)
  const current = useCallback(
    (signal: AbortSignal) => !signal.aborted && mobileIdentityEpoch() === epoch,
    [epoch]
  )

  useLayoutEffect(() => {
    const controller = new AbortController()
    mountRef.current = controller
    return () => {
      controller.abort()
      inFlightRef.current?.abort()
    }
  }, [])

  const memberToken = useCallback(
    async (signal: AbortSignal) => {
      if (!current(signal)) return null
      const token = await resolveMobileAccessToken()
      return current(signal) ? token : null
    },
    [current]
  )

  useEffect(() => {
    const signal = mountRef.current?.signal
    if (!signal) return
    void (async () => {
      try {
        const token = await memberToken(signal)
        if (!current(signal)) return
        if (!token) throw new Error('Sign in to manage capsules.')
        const owner = await resolveOwnerUserId(token)
        if (!current(signal)) return
        setOwnerUserId(owner)
      } catch (error: unknown) {
        if (!current(signal)) return
        setErrorMessage(
          error instanceof Error ? error.message : 'Sign in to manage capsules.'
        )
        setIsLoading(false)
      }
    })()
  }, [current, memberToken])

  /** Debounce keystrokes into one query instead of a request per character. */
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadCapsules = useCallback(async () => {
    const signal = mountRef.current?.signal
    if (!ownerUserId || !signal || !current(signal)) {
      return
    }

    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller
    const reading = () => !controller.signal.aborted && current(signal)

    setIsLoading(true)
    setErrorMessage(null)
    try {
      const token = await memberToken(controller.signal)
      if (!reading()) return
      if (!token) throw new Error('Sign in to manage capsules.')
      const [page, garmentList] = await Promise.all([
        listCapsulesFromMobile(
          token,
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
        listGarmentsFromMobile(token, controller.signal),
      ])
      if (!reading()) return
      setCapsules(page.items)
      setTotal(page.total)
      setGarments(garmentList)
    } catch (error: unknown) {
      if (!reading()) return
      setErrorMessage(
        error instanceof Error ? error.message : t('wardrobe.capsules.errors.load')
      )
    } finally {
      if (reading()) {
        setIsLoading(false)
      }
    }
  }, [current, memberToken, ownerUserId, searchQuery, occasionFilter, favoriteOnly])

  useEffect(() => {
    void loadCapsules()
  }, [loadCapsules])

  // Story CC-7.6: a garment change this member's Closet confirmed while Capsules is open (a
  // delete that landed, a tag save) reads the capsules again, so a capsule that lost a piece
  // stops showing Ready. `loadCapsules` reads nothing for another account.
  useEffect(() => onWardrobeChanged(() => void loadCapsules()), [loadCapsules])

  const handleSave = async (
    input: CreateOutfitCapsuleInput,
    options: MobileCapsuleSaveOptions
  ) => {
    const signal = mountRef.current?.signal
    if (!signal || !ownerUserId) return
    const token = await memberToken(signal)
    if (!current(signal)) return
    if (!token) throw new Error('Sign in to manage capsules.')
    if (editingCapsule && options.ifMatch) {
      await updateCapsuleFromMobile(
        token,
        ownerUserId,
        editingCapsule.id,
        input,
        options.ifMatch,
        signal
      )
    } else {
      await createCapsuleFromMobile(
        token,
        ownerUserId,
        input,
        options.idempotencyKey,
        signal
      )
    }
    if (!current(signal)) return
    setStatusMessage(
      t(
        editingCapsule && options.ifMatch
          ? 'wardrobe.capsules.updated'
          : 'wardrobe.capsules.created'
      )
    )
    await loadCapsules()
  }

  const handleToggleFavorite = async (capsule: OutfitCapsuleContract) => {
    const signal = mountRef.current?.signal
    if (!signal || !ownerUserId) return
    try {
      const token = await memberToken(signal)
      if (!current(signal)) return
      if (!token) throw new Error('Sign in to manage capsules.')
      await favoriteCapsuleFromMobile(
        token,
        ownerUserId,
        capsule.id,
        !capsule.isFavorite,
        capsuleETag(capsule.id, capsule.revision),
        signal
      )
      if (!current(signal)) return
      setStatusMessage(t('wardrobe.capsules.favoriteUpdated'))
      await loadCapsules()
    } catch (error: unknown) {
      if (!current(signal)) return
      setErrorMessage(
        error instanceof Error ? error.message : t('wardrobe.capsules.errors.save')
      )
    }
  }

  const confirmDelete = (capsule: OutfitCapsuleContract) => {
    const signal = mountRef.current?.signal
    if (!signal || !ownerUserId || !current(signal)) return
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
                const token = await memberToken(signal)
                if (!current(signal)) return
                if (!token) throw new Error('Sign in to manage capsules.')
                await deleteCapsuleFromMobile(
                  token,
                  ownerUserId,
                  capsule.id,
                  capsuleETag(capsule.id, capsule.revision),
                  signal
                )
                if (!current(signal)) return
                setStatusMessage(t('wardrobe.capsules.deleted'))
                await loadCapsules()
              } catch (error: unknown) {
                if (!current(signal)) return
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
    <View style={[styles.screen, themed.screen]}>
      <Stack.Screen
        options={{
          headerLeft: () => <WardrobeBackButton />,
          title: t('wardrobe.capsules.title'),
        }}
      />

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
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, themed.field]}
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
          disabled={!ownerUserId}
          style={[styles.primaryButton, themed.primaryButton]}
          testID="create-capsule-button"
        >
          <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
            {t('wardrobe.capsules.create')}
          </Text>
        </Pressable>
      </View>

      {/* flexGrow 0: a ScrollView grows by default, and this one stretched every chip down
          to the bottom of the screen and pushed the empty state under the gesture bar. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroller}
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
              style={[
                styles.filterChip,
                themed.filterChip,
                selected && themed.filterChipSelected,
              ]}
              testID={`capsule-occasion-filter-${occasion}`}
            >
              <Text
                style={[
                  styles.filterText,
                  themed.filterText,
                  selected && themed.filterTextSelected,
                ]}
              >
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
          style={[
            styles.filterChip,
            themed.filterChip,
            favoriteOnly && themed.filterChipSelected,
          ]}
          testID="capsule-favorite-filter"
        >
          <Text
            style={[
              styles.filterText,
              themed.filterText,
              favoriteOnly && themed.filterTextSelected,
            ]}
          >
            ★ {t('wardrobe.capsules.filterFavorites')}
          </Text>
        </Pressable>
      </ScrollView>

      {errorMessage && (
        <View
          style={[styles.errorBox, themed.errorBox]}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          testID="capsule-error-banner"
        >
          <Text style={[styles.errorText, themed.errorText]}>{errorMessage}</Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator
          color={colors.text}
          style={styles.loader}
          testID="capsule-loading-state"
        />
      ) : capsules.length === 0 ? (
        <View style={styles.emptyState} testID="capsule-empty-state">
          <Text style={[styles.emptyTitle, themed.text]}>
            {t('wardrobe.capsules.emptyTitle')}
          </Text>
          <Text style={[styles.emptyBody, themed.mutedText]}>
            {t('wardrobe.capsules.emptyBody')}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
        >
          {capsules.map((capsule) => (
            <View
              key={capsule.id}
              style={[styles.card, themed.card]}
              testID={`capsule-card-${capsule.id}`}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, themed.text]}>{capsule.name}</Text>
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
                <Text style={[styles.cardBody, themed.mutedText]}>
                  {capsule.description}
                </Text>
              ) : null}

              <Text style={[styles.cardMeta, themed.mutedText]}>
                {capsule.garments.length} garments ·{' '}
                {capsule.availabilityStatus === 'ready' ? 'Ready' : 'Needs repair'}
              </Text>

              {capsule.unavailableGarmentCount > 0 && (
                <Text
                  style={[styles.repairText, themed.repairText]}
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
                  style={[styles.secondaryButton, themed.secondaryButton]}
                  testID={`edit-capsule-button-${capsule.id}`}
                >
                  <Text style={[styles.secondaryButtonText, themed.text]}>
                    {t('wardrobe.capsules.edit')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(capsule)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('wardrobe.capsules.delete')}: ${capsule.name}`}
                  style={[styles.destructiveButton, themed.destructiveButton]}
                  testID={`delete-capsule-button-${capsule.id}`}
                >
                  <Text style={[styles.destructiveButtonText, themed.errorText]}>
                    {t('wardrobe.capsules.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}

          {hiddenCount > 0 && (
            <Text
              style={[styles.truncation, themed.mutedText]}
              testID="capsule-truncation-notice"
            >
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
  screen: { flex: 1 },
  visuallyHidden: { height: 0, opacity: 0, width: 0 },
  toolbar: { flexDirection: 'row', gap: 12, padding: 16 },
  searchInput: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontWeight: '600' },
  filterScroller: { flexGrow: 0 },
  filterRow: { gap: 8, paddingBottom: 8, paddingHorizontal: 16 },
  filterChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
  },
  filterText: { fontSize: 13, textTransform: 'capitalize' },
  errorBox: { margin: 16, padding: 12 },
  errorText: { fontSize: 13 },
  loader: { marginTop: 40 },
  emptyState: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { marginTop: 4, textAlign: 'center' },
  list: { gap: 12, padding: 16 },
  card: {
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
  cardBody: { fontSize: 13 },
  cardMeta: { fontSize: 12 },
  repairText: { fontSize: 12 },
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
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { fontSize: 13 },
  destructiveButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
  },
  destructiveButtonText: { fontSize: 13 },
  truncation: { fontSize: 12, textAlign: 'center' },
})

/** The OS light/dark colors for the layout above. */
const useThemedStyles = createSchemeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  text: { color: colors.text },
  mutedText: { color: colors.mutedText },
  field: { borderColor: colors.strongBorder, color: colors.text },
  primaryButton: { backgroundColor: colors.inverseSurface },
  primaryButtonText: { color: colors.onInverse },
  filterChip: { borderColor: colors.strongBorder },
  filterChipSelected: {
    backgroundColor: colors.inverseSurface,
    borderColor: colors.inverseSurface,
  },
  filterText: { color: colors.text },
  filterTextSelected: { color: colors.onInverse },
  errorBox: { backgroundColor: colors.dangerSurface },
  errorText: { color: colors.dangerText },
  card: { backgroundColor: colors.surface, borderColor: colors.border },
  secondaryButton: { borderColor: colors.strongBorder },
  destructiveButton: { borderColor: colors.dangerBorder },
  repairText: { color: colors.noticeText },
}))
