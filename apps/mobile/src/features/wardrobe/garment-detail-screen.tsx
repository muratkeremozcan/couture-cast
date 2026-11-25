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
  AppState,
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
  getSaveFeedbackUrgency,
  SAVE_FEEDBACK_TIMINGS,
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
  // The root provider's floating bar sits under a pushed native stack screen on Android, so the
  // detail always owns its bar. It floats over this screen (the route zeroes the tab bar
  // clearance) and forwards announcements to the root provider when one is mounted. Keyed by
  // the identity epoch, so another account never sees this account's notice or Undo.
  return (
    <SaveFeedbackProvider key={epoch} renderOfflineLine={false}>
      <MemberGarmentDetail epoch={epoch} garmentId={garmentId} />
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
      current
        ? current.map((item) =>
            item.id === updated.id
              ? // A photo the API could not sign this time keeps the one already shown,
                // which still renews on expiry or on a load error.
                { ...updated, imageAccess: updated.imageAccess ?? item.imageAccess }
              : item
          )
        : current
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
    // A current read failure comes first: an id missing from an older read may be back.
    const failed = closet.loadFailed && !closet.loading
    const settled = closet.garments !== null && !failed
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
          <GarmentDetailPhoto garment={garment} label={title} onRefresh={closet.reload} />
          <Text accessibilityRole="header" style={[styles.title, themed.text]}>
            {title}
          </Text>
          <GarmentTagPanel
            garment={garment}
            owner={owner}
            epoch={epoch}
            onRefresh={closet.reload}
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

/**
 * Notice and announcement ids come from one counter for the app session, so they stay unique
 * across detail mounts: the root provider announces each id once and would drop a repeat,
 * such as the first "Saved" after the detail is reopened.
 */
let garmentTagRunSeq = 0
const nextGarmentTagSeq = () => ++garmentTagRunSeq

type GarmentTagSaveState = 'idle' | 'saving' | 'still-saving'

/**
 * The tag editor's save lifecycle, on the CC-7.1 timings: "Saving" at once, "Still saving"
 * after `SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs`, each announced once; then "Saved" with
 * Undo, "No changes", or a distinct failure. Done sends the tags it loaded as `expected` and
 * Undo the tags it saved, so neither overwrites a newer edit (409 GARMENT_TAGS_CHANGED). A new
 * Done retires the previous Undo, so a stale Undo cannot run.
 */
function useGarmentTagEditor({
  garment,
  owner,
  epoch,
  onTagsSaved,
  onRefresh,
}: {
  garment: ClosetGarment
  owner: string | null
  epoch: number
  onTagsSaved: (garment: GarmentWithColor) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const mountedRef = useRef(true)
  const handleDoneRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const saveRunRef = useRef(0)
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoRef = useRef<{ noticeId: string; epoch: number } | null>(null)
  const undoEpochRef = useRef(0)
  const undoInFlightRef = useRef(false)
  // Counts committed Done saves. An Undo answer that lands after a newer Done committed must
  // not replace that Done's garment.
  const doneCommitsRef = useRef(0)
  // The tags the editor opened with. A background list read can change `saved` while the
  // editor is open; No changes, `expected` and the Undo target all use this snapshot instead.
  const baselineRef = useRef<GarmentTagDraft | null>(null)
  // Set by a 409: the next list read is the member's review point, so it becomes the baseline.
  const rebaseAfterConflictRef = useRef(false)
  const [draft, setDraft] = useState<GarmentTagDraft | null>(null)
  const [saveState, setSaveState] = useState<GarmentTagSaveState>('idle')
  const [failure, setFailure] = useState<GarmentTagSaveFailure | null>(null)
  const saved = garmentTagDraft(garment)

  const clearSlowTimer = () => {
    if (slowTimerRef.current !== null) clearTimeout(slowTimerRef.current)
    slowTimerRef.current = null
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (slowTimerRef.current !== null) clearTimeout(slowTimerRef.current)
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
  ): string | null => {
    if (!isActiveOwner(actionOwner)) return null
    const seq = nextGarmentTagSeq()
    const id = `garment-tags-${kind}-${seq}`
    statusBarRef.current.showNotice({
      ...notice,
      id,
      announcementId: createAnnouncementToken(`garment-tags-${kind}`, seq),
    })
    return id
  }

  const announce = (state: 'saving' | 'still-saving', runId: number) =>
    statusBarRef.current.announce(
      state === 'saving' ? t('feedback.saving') : t('feedback.stillSaving'),
      {
        announcementId: createAnnouncementToken(`garment-tags-${state}`, runId),
        urgency: getSaveFeedbackUrgency(state),
      }
    )

  const retireUndo = () => {
    undoEpochRef.current++
    const previous = undoRef.current
    undoRef.current = null
    if (previous) statusBarRef.current.dismissNotice(previous.noticeId)
  }

  const saveTags = async (
    actionOwner: string | null,
    target: GarmentTagDraft,
    expected: GarmentTagDraft,
    applies: () => boolean
  ) => {
    const token = await resolveMobileAccessToken()
    if (!token) throw new Error('AUTHENTICATION_REQUIRED')
    const updated = await updateGarmentTagsFromMobile(token, garment.id, {
      ...target,
      expected,
    })
    if (applies() && isActiveOwner(actionOwner)) onTagsSaved(updated)
    return updated
  }

  const runUndo = async (
    actionOwner: string | null,
    previous: GarmentTagDraft,
    savedTags: GarmentTagDraft,
    undoEpoch: number
  ) => {
    if (undoEpoch !== undoEpochRef.current || undoInFlightRef.current) return
    if (!isActiveOwner(actionOwner)) return
    const retry = {
      id: 'retry' as const,
      kind: 'retry' as const,
      label: t('feedback.retry'),
      onPress: () => void runUndo(actionOwner, previous, savedTags, undoEpoch),
    }
    undoInFlightRef.current = true
    try {
      if (!(await ensureOnline())) {
        showNotice(actionOwner, 'undo-offline', {
          message: t('feedback.offlineAction'),
          tone: 'offline',
          actions: [retry],
        })
        return
      }
      const doneCommits = doneCommitsRef.current
      await saveTags(
        actionOwner,
        previous,
        savedTags,
        () => doneCommitsRef.current === doneCommits
      )
      // A newer Done retired this Undo while it ran; its notice must not cover that Saved.
      if (undoEpoch !== undoEpochRef.current) return
      retireUndo()
      showNotice(actionOwner, 'undone', {
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (error) {
      if (undoEpoch !== undoEpochRef.current) return
      const kind = classifyGarmentTagSaveError(error, getNetworkOnline())
      // Another device changed the tags: show what is stored now. The rejected Undo stays final.
      if (kind === 'conflict') onRefresh()
      showNotice(actionOwner, `undo-${kind}`, {
        message:
          kind === 'offline'
            ? t('feedback.offlineAction')
            : kind === 'conflict'
              ? t('wardrobe.detail.conflict')
              : t('wardrobe.detail.undoFailed'),
        tone: kind === 'offline' ? 'offline' : 'error',
        actions: kind === 'conflict' ? [] : [retry],
      })
    } finally {
      undoInFlightRef.current = false
    }
  }

  // After a conflict the editor keeps the draft and the list is read again. When that read
  // lands, the rows above show the stored tags and they become the baseline, so the member's
  // next Done is a deliberate retry against what is stored now.
  useEffect(() => {
    if (!rebaseAfterConflictRef.current || !baselineRef.current) return
    rebaseAfterConflictRef.current = false
    baselineRef.current = garmentTagDraft(garment)
  }, [garment])

  const closeEditor = () => {
    baselineRef.current = null
    rebaseAfterConflictRef.current = false
    setDraft(null)
    setFailure(null)
  }

  const openEditor = () => {
    if (!saved) return
    baselineRef.current = saved
    rebaseAfterConflictRef.current = false
    setFailure(null)
    setDraft(saved)
  }

  const failSave = (actionOwner: string | null, kind: GarmentTagSaveFailure) => {
    setSaveState('idle')
    setFailure(kind)
    // Another edit landed first: keep the draft open, read the stored tags again and use them
    // as the baseline once they land. The conflict message asks the member to check them.
    if (kind === 'conflict') {
      rebaseAfterConflictRef.current = true
      onRefresh()
    }
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

  const handleDone = async () => {
    const baseline = baselineRef.current
    if (!draft || !baseline || saveState !== 'idle') return
    const actionOwner = owner
    if (!isActiveOwner(actionOwner)) return
    retireUndo()
    if (garmentTagsEqual(draft, baseline)) {
      closeEditor()
      showNotice(actionOwner, 'unchanged', {
        message: t('wardrobe.detail.noChanges'),
        tone: 'neutral',
      })
      return
    }
    const previous = baseline
    const target = draft
    const runId = nextGarmentTagSeq()
    saveRunRef.current = runId
    const isCurrentRun = () => mountedRef.current && saveRunRef.current === runId
    setSaveState('saving')
    setFailure(null)
    announce('saving', runId)
    clearSlowTimer()
    slowTimerRef.current = setTimeout(() => {
      slowTimerRef.current = null
      if (!isCurrentRun()) return
      setSaveState('still-saving')
      announce('still-saving', runId)
    }, SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs)
    let updated: GarmentWithColor
    try {
      if (!(await ensureOnline())) {
        if (!isCurrentRun()) return
        clearSlowTimer()
        if (isActiveOwner(actionOwner)) failSave(actionOwner, 'offline')
        return
      }
      updated = await saveTags(actionOwner, target, previous, () => {
        doneCommitsRef.current++
        return true
      })
    } catch (error) {
      if (!isCurrentRun()) return
      clearSlowTimer()
      if (isActiveOwner(actionOwner)) {
        failSave(actionOwner, classifyGarmentTagSaveError(error, getNetworkOnline()))
      }
      return
    }
    if (isCurrentRun()) {
      clearSlowTimer()
      setSaveState('idle')
      closeEditor()
    }
    const savedTags = garmentTagDraft(updated) ?? target
    const undoEpoch = ++undoEpochRef.current
    const noticeId = showNotice(actionOwner, 'saved', {
      message: t('feedback.saved'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => void runUndo(actionOwner, previous, savedTags, undoEpoch),
        },
      ],
    })
    undoRef.current = noticeId ? { noticeId, epoch: undoEpoch } : null
  }
  handleDoneRef.current = handleDone

  return {
    draft,
    setDraft,
    saveState,
    failure,
    failureMessage,
    canEdit: Boolean(saved),
    openEditor,
    closeEditor: () => closeEditor(),
    handleDone,
  }
}

/** A signed photo URL this close to expiry is renewed before it is shown. */
const PHOTO_REFRESH_LEAD_MS = 60_000

/**
 * The detail photo. A signed URL within a minute of expiry, on open or when the app returns to
 * the foreground, asks for a fresh list read; a photo that fails to load shows the placeholder
 * and asks for a fresh URL once per opened garment, so a lasting fault never loops.
 */
function GarmentDetailPhoto({
  garment,
  label,
  onRefresh,
}: {
  garment: ClosetGarment
  label: string
  onRefresh: () => void
}) {
  const themed = useThemedStyles()
  const url = garment.imageAccess?.url ?? null
  const expiresAt = garment.imageAccess?.expiresAt ?? null
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const expiryRefreshedUrlsRef = useRef(new Set<string>())
  const errorRefreshUsedRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const leaseRef = useRef({ url, expiresAt })
  leaseRef.current = { url, expiresAt }

  useEffect(() => {
    errorRefreshUsedRef.current = false
    setFailedUrl(null)
  }, [garment.id])

  const refreshIfStale = useCallback(() => {
    const lease = leaseRef.current
    if (!lease.url || !lease.expiresAt) return
    if (Date.parse(lease.expiresAt) - Date.now() > PHOTO_REFRESH_LEAD_MS) return
    if (expiryRefreshedUrlsRef.current.has(lease.url)) return
    expiryRefreshedUrlsRef.current.add(lease.url)
    onRefreshRef.current()
  }, [])

  useEffect(() => {
    refreshIfStale()
  }, [url, expiresAt, refreshIfStale])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshIfStale()
    })
    return () => subscription.remove()
  }, [refreshIfStale])

  if (!url || failedUrl === url) {
    return (
      <View
        testID="garment-detail-photo"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[styles.photo, themed.placeholder]}
      />
    )
  }
  return (
    <Image
      testID="garment-detail-photo"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      source={{ uri: url }}
      onError={() => {
        setFailedUrl(url)
        if (errorRefreshUsedRef.current) return
        errorRefreshUsedRef.current = true
        onRefreshRef.current()
      }}
      style={styles.photo}
    />
  )
}

function GarmentTagPanel({
  garment,
  owner,
  epoch,
  onRefresh,
  onTagsSaved,
  styleEntry,
}: {
  garment: ClosetGarment
  owner: string | null
  epoch: number
  onRefresh: () => void
  onTagsSaved: (garment: GarmentWithColor) => void
  styleEntry: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const themed = useThemedStyles()
  const values = getGuestPreviewStrings(locale).values
  const labels = formatGarmentTagLabels(locale, garment)
  const editor = useGarmentTagEditor({ garment, owner, epoch, onTagsSaved, onRefresh })
  const { draft, setDraft, failure, saveState } = editor
  const saving = saveState !== 'idle'

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
              // Without this the web target renders a radio with no checked state
              // (community-post-sheet.tsx precedent).
              aria-checked={pressed}
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
                {editor.failureMessage(failure)}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              testID="garment-tag-done"
              onPress={() => void editor.handleDone()}
              style={[styles.primaryButton, themed.primaryButton]}
            >
              <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>
                {saveState === 'still-saving'
                  ? t('feedback.stillSaving')
                  : saveState === 'saving'
                    ? t('feedback.saving')
                    : t('wardrobe.detail.done')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              testID="garment-tag-cancel"
              onPress={editor.closeEditor}
              style={[styles.secondaryButton, themed.secondaryButton]}
            >
              <Text style={[styles.secondaryButtonText, themed.text]}>
                {t('wardrobe.detail.cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !editor.canEdit }}
              disabled={!editor.canEdit}
              testID="garment-edit-tags"
              onPress={editor.openEditor}
              style={[styles.secondaryButton, themed.secondaryButton]}
            >
              <Text style={[styles.secondaryButtonText, themed.text]}>
                {t('wardrobe.detail.editTags')}
              </Text>
            </Pressable>
            {styleEntry}
          </View>
        </>
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
