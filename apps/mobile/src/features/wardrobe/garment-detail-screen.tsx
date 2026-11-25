// Story CC-7.5 D3: the native garment detail, a pushed stack route (`/wardrobe-garment?id=`)
// with a header back control. It reads the garment from the list endpoint; an id that is gone
// or no longer ready shows "no longer in your closet". Done saves through the CC-7.1 status
// bar ("Saved" with Undo, "No changes", distinct failures) and tells the hub to reload.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { router, Stack } from 'expo-router'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type {
  GarmentComfortRange,
  GarmentMaterial,
  GarmentWithColor,
} from '@couture/api-client/contracts/http'
import {
  classifyGarmentTagSaveError,
  COMFORT_RANGES,
  createAnnouncementToken,
  formatGarmentAlt,
  formatGarmentCategory,
  formatGarmentTagLabels,
  garmentTagDraft,
  garmentTagsEqual,
  getGuestPreviewStrings,
  getStylePieceStrings,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_MATERIALS,
  type GarmentTagDraft,
  type GarmentTagSaveFailure,
  type StylePieceSelection,
} from '@couture/utils'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  SaveFeedbackProvider,
  useStatusBar,
} from '@/components/save-feedback'
import { createSchemeStyles, useSchemeColors } from '@/components/themed'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { listGarmentsFromMobile, updateGarmentTagsFromMobile } from '@/src/lib/wardrobe'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import {
  focusStylePieceControl,
  StylePieceEntry,
  StylePiecePanel,
} from './style-piece-panel'

/** A Closet garment: list reads carry `colorFamily`; a just-committed upload may not yet. */
export type ClosetGarment = Omit<GarmentWithColor, 'colorFamily'> &
  Partial<Pick<GarmentWithColor, 'colorFamily'>>

/** D6: the accessibility label of a member garment photo ("Blue top"). */
export function garmentPhotoLabel(locale: string, garment: ClosetGarment): string {
  return formatGarmentAlt(locale, {
    colorFamily: garment.colorFamily ?? null,
    category: garment.category,
  })
}

/** The visible card label: localized category and material, or "Untagged garment". */
export function garmentCardLabel(locale: string, garment: ClosetGarment): string {
  if (!garment.category) return formatGarmentAlt(locale, { category: null })
  const labels = formatGarmentTagLabels(locale, garment)
  return [labels.category, labels.material].filter(Boolean).join(' · ')
}

/** The header back control: back to the hub, which kept its scroll position. */
export function GarmentDetailBackButton() {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('wardrobe.detail.back')}
      testID="garment-detail-back"
      style={styles.backButton}
      onPress={() => {
        if (router.canGoBack()) router.back()
        else router.dismissTo('/wardrobe')
      }}
    >
      <Text style={{ color: colors.text }}>{t('wardrobe.detail.back')}</Text>
    </Pressable>
  )
}

export function GarmentDetailScreen({ garmentId }: { garmentId: string | undefined }) {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  const { hasProvider } = useStatusBar()
  const detail = <MemberGarmentDetail key={epoch} epoch={epoch} garmentId={garmentId} />
  if (hasProvider) return detail
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      {detail}
    </SaveFeedbackProvider>
  )
}

async function ensureOnline(): Promise<boolean> {
  if (getNetworkOnline()) return true
  if (hasReliableBrowserOnline()) return false
  return checkNetworkOnlineForAction()
}

function useClosetGarments(epoch: number) {
  const [garments, setGarments] = useState<ClosetGarment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const revision = useRef(0)

  const loadInventory = useCallback(
    async (signal: AbortSignal) => {
      const started = ++revision.current
      const token = await resolveMobileAccessToken()
      if (signal.aborted || epoch !== mobileIdentityEpoch()) return null
      if (!token) throw new Error('AUTHENTICATION_REQUIRED')
      const next = await listGarmentsFromMobile(token, signal)
      if (signal.aborted || epoch !== mobileIdentityEpoch()) return null
      if (started !== revision.current) return next
      setGarments(next)
      setLoadFailed(false)
      return next
    },
    [epoch]
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadInventory(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [loadAttempt, loadInventory])

  const replaceGarment = useCallback((updated: GarmentWithColor) => {
    revision.current++
    setGarments((current) =>
      current ? current.map((item) => (item.id === updated.id ? updated : item)) : current
    )
  }, [])

  return {
    garments,
    loading,
    loadFailed,
    loadInventory,
    replaceGarment,
    reload: () => setLoadAttempt((attempt) => attempt + 1),
  }
}

function MemberGarmentDetail({
  epoch,
  garmentId,
}: {
  epoch: number
  garmentId: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const themed = useThemedStyles()
  const owner = mobileApplicationUserId()
  const closet = useClosetGarments(epoch)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [styleClosing, setStyleClosing] = useState(false)
  const styleButtonRef = useRef<ComponentRef<typeof Pressable> | null>(null)

  const garment =
    closet.garments?.find((item) => item.id === garmentId && item.status === 'ready') ??
    null
  const title = garment ? garmentPhotoLabel(locale, garment) : ''

  const header = (
    <Stack.Screen options={{ title, headerLeft: () => <GarmentDetailBackButton /> }} />
  )

  if (!garment) {
    const settled = closet.garments !== null
    const failed = !settled && closet.loadFailed && !closet.loading
    return (
      <View
        style={[styles.screen, themed.screen]}
        testID={settled ? 'garment-detail-missing' : 'garment-detail-loading'}
      >
        {header}
        {settled ? (
          <Text style={[styles.missingText, themed.text]}>
            {t('wardrobe.detail.missing')}
          </Text>
        ) : failed ? (
          <View style={styles.missingBox}>
            <Text style={[styles.bodyText, themed.text]}>
              {t('wardrobe.detail.loadFailed')}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, themed.secondaryButton]}
              onPress={closet.reload}
            >
              <Text style={[styles.secondaryButtonText, themed.text]}>
                {getGuestPreviewStrings(locale).chrome.retry}
              </Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator
            accessibilityLabel={t('wardrobe.detail.loading')}
            style={styles.loader}
          />
        )}
      </View>
    )
  }

  return (
    <>
      <View style={[styles.screen, themed.screen]}>
        {header}
        <ScrollView contentContainerStyle={styles.content} testID="garment-detail">
          {garment.imageAccess ? (
            <Image
              testID="garment-detail-photo"
              accessible
              accessibilityRole="image"
              accessibilityLabel={title}
              source={{ uri: garment.imageAccess.url }}
              style={styles.photo}
            />
          ) : (
            <View
              testID="garment-detail-photo"
              accessible
              accessibilityRole="image"
              accessibilityLabel={title}
              style={[styles.photo, themed.placeholder]}
            />
          )}
          <Text accessibilityRole="header" style={[styles.title, themed.text]}>
            {title}
          </Text>
          <GarmentTagPanel
            garment={garment}
            owner={owner}
            epoch={epoch}
            onTagsSaved={(updated) => {
              closet.replaceGarment(updated)
              notifyWardrobeChanged()
            }}
            styleEntry={
              <StylePieceEntry
                garment={garment}
                owner={owner}
                epoch={epoch}
                unavailable={closet.loadFailed}
                loading={closet.loading}
                labels={getStylePieceStrings(locale)}
                buttonRef={styleButtonRef}
                onRefresh={closet.reload}
                onOpen={(selection) => {
                  if (styleSelection) return
                  setStyleSelection(selection)
                }}
              />
            }
          />
        </ScrollView>
      </View>

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          inWardrobe
          loadInventory={closet.loadInventory}
          visible={!styleClosing}
          owner={owner}
          epoch={epoch}
          locale={locale}
          onClose={() => setStyleClosing(true)}
          onDismiss={() => {
            if (epoch !== mobileIdentityEpoch()) return
            setStyleSelection(null)
            setStyleClosing(false)
            requestAnimationFrame(() => focusStylePieceControl(styleButtonRef.current))
          }}
        />
      )}
    </>
  )
}

function GarmentTagPanel({
  garment,
  owner,
  epoch,
  onTagsSaved,
  styleEntry,
}: {
  garment: ClosetGarment
  owner: string | null
  epoch: number
  onTagsSaved: (garment: GarmentWithColor) => void
  styleEntry: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const themed = useThemedStyles()
  const values = getGuestPreviewStrings(locale).values
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const mountedRef = useRef(true)
  const noticeSeqRef = useRef(0)
  const handleDoneRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const [draft, setDraft] = useState<GarmentTagDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<GarmentTagSaveFailure | null>(null)
  const labels = formatGarmentTagLabels(locale, garment)
  const saved = garmentTagDraft(garment)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isActiveOwner = (actionOwner: string | null) =>
    Boolean(actionOwner) &&
    epoch === mobileIdentityEpoch() &&
    mobileApplicationUserId() === actionOwner

  const failureMessage = (kind: GarmentTagSaveFailure) =>
    kind === 'conflict'
      ? t('wardrobe.detail.conflict')
      : kind === 'not-allowed'
        ? t('wardrobe.detail.notAllowed')
        : kind === 'offline'
          ? t('feedback.offlineAction')
          : t('feedback.saveFailed')

  const showNotice = (
    actionOwner: string | null,
    kind: string,
    notice: Omit<Parameters<typeof statusBar.showNotice>[0], 'id' | 'announcementId'>
  ) => {
    if (!isActiveOwner(actionOwner)) return
    const seq = ++noticeSeqRef.current
    statusBarRef.current.showNotice({
      ...notice,
      id: `garment-tags-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`garment-tags-${kind}`, seq),
    })
  }

  const saveTags = async (actionOwner: string | null, target: GarmentTagDraft) => {
    const token = await resolveMobileAccessToken()
    if (!token) throw new Error('AUTHENTICATION_REQUIRED')
    const updated = await updateGarmentTagsFromMobile(token, garment.id, {
      category: target.category,
      material: target.material,
      comfortRange: target.comfortRange,
    })
    if (isActiveOwner(actionOwner)) onTagsSaved(updated)
    return updated
  }

  const runUndo = async (actionOwner: string | null, previous: GarmentTagDraft) => {
    if (!isActiveOwner(actionOwner)) return
    const retry = {
      id: 'retry' as const,
      kind: 'retry' as const,
      label: t('feedback.retry'),
      onPress: () => void runUndo(actionOwner, previous),
    }
    if (!(await ensureOnline())) {
      showNotice(actionOwner, 'undo-offline', {
        message: t('feedback.offlineAction'),
        tone: 'offline',
        actions: [retry],
      })
      return
    }
    try {
      await saveTags(actionOwner, previous)
      showNotice(actionOwner, 'undone', {
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (error) {
      const kind = classifyGarmentTagSaveError(error, getNetworkOnline())
      showNotice(actionOwner, `undo-${kind}`, {
        message:
          kind === 'offline'
            ? t('feedback.offlineAction')
            : t('wardrobe.detail.undoFailed'),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions: [retry],
      })
    }
  }

  const closeEditor = () => {
    setDraft(null)
    setFailure(null)
  }

  const handleDone = async () => {
    if (!draft || !saved || saving) return
    const actionOwner = owner
    if (!isActiveOwner(actionOwner)) return
    if (garmentTagsEqual(draft, saved)) {
      closeEditor()
      showNotice(actionOwner, 'unchanged', {
        message: t('wardrobe.detail.noChanges'),
        tone: 'neutral',
      })
      return
    }
    const previous = saved
    const target = draft
    setSaving(true)
    setFailure(null)
    const fail = (kind: GarmentTagSaveFailure) => {
      setSaving(false)
      setFailure(kind)
      showNotice(actionOwner, kind, {
        message: failureMessage(kind),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions:
          kind === 'offline' || kind === 'failed'
            ? [
                {
                  id: 'retry',
                  kind: 'retry',
                  label: t('feedback.retry'),
                  onPress: () => void handleDoneRef.current(),
                },
              ]
            : [],
      })
    }
    if (!(await ensureOnline())) {
      if (mountedRef.current && isActiveOwner(actionOwner)) fail('offline')
      return
    }
    try {
      await saveTags(actionOwner, target)
    } catch (error) {
      if (mountedRef.current && isActiveOwner(actionOwner)) {
        fail(classifyGarmentTagSaveError(error, getNetworkOnline()))
      }
      return
    }
    if (mountedRef.current) {
      setSaving(false)
      closeEditor()
    }
    showNotice(actionOwner, 'saved', {
      message: t('feedback.saved'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => void runUndo(actionOwner, previous),
        },
      ],
    })
  }
  handleDoneRef.current = handleDone

  const tagRow = (testID: string, label: string, value: string) => (
    <View style={[styles.tagRow, themed.divider]}>
      <Text style={[styles.tagLabel, themed.mutedText]}>{label}</Text>
      <Text testID={testID} style={[styles.tagValue, themed.text]}>
        {value}
      </Text>
    </View>
  )

  const field = <V extends string>(
    name: 'category' | 'material' | 'comfort',
    legend: string,
    options: readonly { value: V; label: string }[],
    selected: V,
    onSelect: (value: V) => void
  ) => (
    <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={legend}>
      <Text style={[styles.legend, themed.text]}>{legend}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const pressed = option.value === selected
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: pressed, disabled: saving }}
              disabled={saving}
              testID={`garment-tag-option-${name}-${option.value}`}
              onPress={() => onSelect(option.value)}
              style={[styles.chip, pressed ? themed.chipSelected : themed.chip]}
            >
              <Text style={pressed ? themed.chipTextSelected : themed.text}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )

  return (
    <View>
      {tagRow(
        'garment-detail-category',
        t('wardrobe.detail.category'),
        labels.category ?? ''
      )}
      {tagRow(
        'garment-detail-material',
        t('wardrobe.detail.material'),
        labels.material ?? t('wardrobe.detail.noMaterial')
      )}
      {tagRow(
        'garment-detail-comfort',
        t('wardrobe.detail.comfort'),
        labels.comfort ?? ''
      )}

      {draft ? (
        <View testID="garment-tag-editor" style={styles.editor}>
          {field(
            'category',
            t('wardrobe.detail.category'),
            SAMPLE_GARMENT_CATEGORIES.map((value) => ({
              value,
              label: formatGarmentCategory(locale, value),
            })),
            draft.category,
            (category) => setDraft({ ...draft, category })
          )}
          {field<GarmentMaterial | 'none'>(
            'material',
            t('wardrobe.detail.material'),
            [
              ...SAMPLE_GARMENT_MATERIALS.map((value) => ({
                value,
                label: values.material[value],
              })),
              { value: 'none' as const, label: t('wardrobe.detail.noMaterial') },
            ],
            draft.material ?? 'none',
            (material) =>
              setDraft({ ...draft, material: material === 'none' ? null : material })
          )}
          {field<GarmentComfortRange>(
            'comfort',
            t('wardrobe.detail.comfort'),
            COMFORT_RANGES.map((value) => ({
              value,
              label:
                formatGarmentTagLabels(locale, { comfortRange: value }).comfort ?? value,
            })),
            draft.comfortRange,
            (comfortRange) => setDraft({ ...draft, comfortRange })
          )}
          {failure ? (
            <View style={[styles.errorBox, themed.errorBox]}>
              <Text testID="garment-tag-error" style={themed.errorText}>
                {failureMessage(failure)}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              testID="garment-tag-done"
              onPress={() => void handleDone()}
              style={[styles.primaryButton, themed.primaryButton]}
            >
              <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
                {saving ? t('feedback.saving') : t('wardrobe.detail.done')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              testID="garment-tag-cancel"
              onPress={closeEditor}
              style={[styles.secondaryButton, themed.secondaryButton]}
            >
              <Text style={[styles.secondaryButtonText, themed.text]}>
                {t('wardrobe.detail.cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !saved }}
            disabled={!saved}
            testID="garment-edit-tags"
            onPress={() => {
              if (!saved) return
              setFailure(null)
              setDraft(saved)
            }}
            style={[styles.secondaryButton, themed.secondaryButton]}
          >
            <Text style={[styles.secondaryButtonText, themed.text]}>
              {t('wardrobe.detail.editTags')}
            </Text>
          </Pressable>
          {styleEntry}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 12, padding: 20, paddingBottom: 120 },
  backButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  photo: { alignSelf: 'center', aspectRatio: 0.75, borderRadius: 12, width: '70%' },
  title: { fontSize: 22, fontWeight: '700' },
  tagRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  tagLabel: { fontSize: 14 },
  tagValue: { flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  editor: { gap: 4, marginTop: 8 },
  field: { gap: 8, marginTop: 12 },
  legend: { fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontWeight: '700' },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  errorBox: { borderRadius: 8, marginTop: 12, padding: 12 },
  missingBox: { gap: 12, padding: 20 },
  missingText: { fontSize: 16, fontWeight: '600', padding: 20 },
  bodyText: { fontSize: 14 },
  loader: { marginTop: 40 },
})

/** The OS light/dark colors for the layout above. */
const useThemedStyles = createSchemeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  text: { color: colors.text },
  mutedText: { color: colors.mutedText },
  divider: { borderBottomColor: colors.border },
  placeholder: { backgroundColor: colors.subtleSurface },
  chip: { borderColor: colors.strongBorder },
  chipSelected: {
    backgroundColor: colors.inverseSurface,
    borderColor: colors.inverseSurface,
  },
  chipTextSelected: { color: colors.onInverse },
  primaryButton: { backgroundColor: colors.inverseSurface },
  primaryButtonText: { color: colors.onInverse },
  secondaryButton: { borderColor: colors.strongBorder },
  errorBox: { backgroundColor: colors.dangerSurface },
  errorText: { color: colors.dangerText },
}))
