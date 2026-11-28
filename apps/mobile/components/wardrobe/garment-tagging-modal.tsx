// Story 4.2 Task 8 step 1 owner: implement native mobile garment tagging modal component in apps/mobile/components/wardrobe/garment-tagging-modal.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  BackHandler,
  Image,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native'
import type {
  GarmentCategory,
  GarmentMaterial,
  GarmentComfortRange,
  GarmentItemContract,
  GarmentWithTags,
  SuggestGarmentTagsData,
  SuggestGarmentTagsSuggestedData,
  UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import {
  confidentGarmentTag,
  garmentSubtypeMatchesCategory,
  garmentSubtypeStrings,
  garmentTaggingStrings,
  resolveGarmentSubtypeSelection,
  type GarmentSubtype,
} from '@couture/utils'
import {
  suggestGarmentTagsFromMobile,
  updateGarmentTagsFromMobile,
} from '../../src/lib/wardrobe'
import { useAccessibilityAnnouncer } from '../../src/hooks/use-accessibility-announcer'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { createSchemeStyles, useSchemeColors } from '@/components/themed'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'
import { useTokens } from '@/src/theme/tokens'

export interface MobileGarmentTaggingModalProps {
  visible: boolean
  onClose: () => void
  garmentId: string | null
  initialGarment?: Pick<GarmentWithTags, 'id' | 'category' | 'subtype'> &
    Partial<Pick<GarmentWithTags, 'imageAccess'>>
  accessToken: string
  onTagsConfirmed?: (garment: GarmentItemContract) => void
  suggestTagsFn?: (
    accessToken: string,
    garmentId: string,
    signal?: AbortSignal
  ) => Promise<SuggestGarmentTagsData>
  updateTagsFn?: (
    accessToken: string,
    garmentId: string,
    tags: UpdateGarmentTagsInput,
    signal?: AbortSignal
  ) => Promise<GarmentItemContract>
  invokingNodeHandle?: number | null
}

const CATEGORY_OPTIONS: GarmentCategory[] = [
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory',
]

const MATERIAL_OPTIONS: GarmentMaterial[] = [
  'cotton',
  'wool',
  'linen',
  'leather',
  'denim',
  'fleece',
  'synthetic',
  'down',
  'silk',
]

const COMFORT_OPTIONS: GarmentComfortRange[] = ['cold', 'cool', 'mild', 'warm', 'hot']

interface TaggingErrorProps {
  message: string | null
  isLoading: boolean
  retryLabel: string
  onRetry: () => void
}

function TaggingError({ message, isLoading, retryLabel, onRetry }: TaggingErrorProps) {
  const styles = useStyles()
  if (!message) return null

  return (
    <View>
      <Text style={styles.errorText} accessibilityRole="alert">
        {message}
      </Text>
      {!isLoading && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.retryBtn}
          onPress={onRetry}
        >
          <Text style={styles.retryText}>{retryLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// eslint-disable-next-line complexity
export function MobileGarmentTaggingModal({
  visible,
  onClose,
  garmentId,
  initialGarment,
  accessToken,
  onTagsConfirmed,
  suggestTagsFn = suggestGarmentTagsFromMobile,
  updateTagsFn = updateGarmentTagsFromMobile,
  invokingNodeHandle,
}: MobileGarmentTaggingModalProps) {
  const modalAnimation = useModalAnimation('slide')
  const { t, i18n } = useTranslation()
  const copy = garmentTaggingStrings(i18n.language)
  const insets = useModalInsets()
  const styles = useStyles()
  const colors = useSchemeColors()
  const { scrim } = useTokens()
  const { announce } = useAccessibilityAnnouncer()
  const [chosenCategory, setChosenCategory] = useState<GarmentCategory | null>(null)
  // Undefined leaves the stored subtype alone. A member's explicit None is null.
  const [chosenSubtype, setChosenSubtype] = useState<GarmentSubtype | null>()
  const [chosenMaterial, setChosenMaterial] = useState<GarmentMaterial | null>()
  const [chosenComfort, setChosenComfort] = useState<GarmentComfortRange>()
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isAnalysisPending, setIsAnalysisPending] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestGarmentTagsSuggestedData | null>(
    null
  )
  // The API answered `mode: 'manual'`: no model ran, so the member chooses every tag.
  const [isManualMode, setIsManualMode] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const titleRef = useRef<React.ElementRef<typeof Text> | null>(null)
  const saveAbortRef = useRef<AbortController | null>(null)
  const onCloseRef = useRef(onClose)
  const invokingNodeHandleRef = useRef(invokingNodeHandle)
  const modalSessionRef = useRef(0)
  onCloseRef.current = onClose
  invokingNodeHandleRef.current = invokingNodeHandle

  // The reader's focus moves to the title only once the answer names the mode (suggested or
  // manual) or the request settled, so it never announces a title that the answer then
  // contradicts. With no garment there is no request to wait for.
  useEffect(() => {
    if (!visible || isLoading || Platform.OS === 'web') return
    const focusTimer = setTimeout(() => {
      const node = safeFindNodeHandle(titleRef.current)
      if (node) AccessibilityInfo.setAccessibilityFocus(node)
    }, 150)
    return () => clearTimeout(focusTimer)
  }, [visible, isLoading])

  useEffect(() => {
    if (!visible) return
    // react-native-web's BackHandler is a stub that warns on every call; a browser has no
    // hardware Back for the sheet to answer.
    const backSubscription =
      Platform.OS === 'web'
        ? null
        : BackHandler.addEventListener('hardwareBackPress', () => {
            onCloseRef.current()
            return true
          })
    // Story CC-7.11 D13: EdgeToEdgeModal hands focus back to the invoker (returnFocusRef).
    return () => {
      backSubscription?.remove()
    }
  }, [visible])

  useEffect(() => {
    modalSessionRef.current += 1
    saveAbortRef.current?.abort()
    saveAbortRef.current = null
    setIsSaving(false)
    setChosenCategory(null)
    setChosenSubtype(undefined)
    setChosenMaterial(undefined)
    setChosenComfort(undefined)
    setSuggestions(null)
    setIsManualMode(false)
    setSuggestionError(null)
    setSaveError(null)
    setIsLoading(false)
    setFailedPreviewUrl(null)
    setIsAnalysisPending(false)
  }, [accessToken, garmentId, visible])

  useEffect(
    () => () => {
      saveAbortRef.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (!visible || !garmentId) return

    const controller = new AbortController()
    let isMounted = true
    setIsLoading(true)
    setSuggestionError(null)
    setSaveError(null)
    setIsAnalysisPending(false)

    announce('feedback', t('wardrobe.tagging.loading'))
    suggestTagsFn(accessToken, garmentId, controller.signal)
      .then((data) => {
        if (!isMounted) return
        if (data.mode === 'manual') {
          setSuggestions(null)
          setIsManualMode(true)
          return
        }
        setIsManualMode(false)
        setSuggestions(data)
      })
      .catch((err: unknown) => {
        if (!isMounted) return
        const msg = err instanceof Error ? err.message : ''
        const code =
          err &&
          typeof err === 'object' &&
          'code' in err &&
          typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : ''
        const localized =
          code === 'GARMENT_ANALYSIS_PENDING'
            ? t('wardrobe.tagging.pending_analysis')
            : code === 'TAGGING_INFERENCE_UNAVAILABLE'
              ? t('wardrobe.tagging.inference_unavailable')
              : msg || t('wardrobe.tagging.load_failed')
        setIsAnalysisPending(code === 'GARMENT_ANALYSIS_PENDING')
        setSuggestionError(localized)
        announce('error', localized)
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [accessToken, announce, garmentId, loadAttempt, suggestTagsFn, t, visible])

  const storedGarment = initialGarment?.id === garmentId ? initialGarment : undefined
  const storedCategory = storedGarment?.category ?? null
  const storedSubtype = garmentSubtypeMatchesCategory(
    storedCategory,
    storedGarment?.subtype
  )
  const scoredTags = suggestions?.suggestions
  const awaitingInitialSuggestions = isLoading && !scoredTags
  const previewUrl = storedGarment?.imageAccess?.url
  const selectedCategory =
    chosenCategory ??
    (storedSubtype ? storedCategory : null) ??
    confidentGarmentTag(scoredTags?.category) ??
    null
  const selectedMaterial =
    chosenMaterial !== undefined
      ? chosenMaterial
      : scoredTags || awaitingInitialSuggestions
        ? confidentGarmentTag(scoredTags?.material)
        : null
  const selectedComfort = chosenComfort ?? confidentGarmentTag(scoredTags?.comfortRange)
  const subtype = resolveGarmentSubtypeSelection(
    selectedCategory,
    chosenSubtype,
    storedGarment,
    scoredTags
  )
  const displayedSubtype =
    awaitingInitialSuggestions && chosenSubtype === undefined && subtype.selected === null
      ? undefined
      : subtype.selected
  const tagsToSave: UpdateGarmentTagsInput | null =
    selectedCategory &&
    selectedComfort &&
    selectedMaterial !== undefined &&
    subtype.selected !== undefined
      ? {
          category: selectedCategory,
          ...(subtype.save !== undefined && { subtype: subtype.save }),
          material: selectedMaterial,
          comfortRange: selectedComfort,
        }
      : null
  const isSaveDisabled = !tagsToSave || isSaving || isLoading || isAnalysisPending

  const handleSave = async () => {
    if (!garmentId || !tagsToSave || isSaveDisabled) return

    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    saveAbortRef.current = controller
    const modalSession = modalSessionRef.current

    try {
      const updated = await updateTagsFn(
        accessToken,
        garmentId,
        tagsToSave,
        controller.signal
      )
      if (modalSessionRef.current !== modalSession || controller.signal.aborted) return
      announce('feedback', t('wardrobe.tagging.saved'))
      onTagsConfirmed?.(updated)
      onClose()
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t('wardrobe.tagging.save_failed')
      if (!controller.signal.aborted && modalSessionRef.current === modalSession) {
        setSaveError(message)
        announce('error', message)
      }
    } finally {
      if (modalSessionRef.current === modalSession) setIsSaving(false)
      if (saveAbortRef.current === controller) saveAbortRef.current = null
    }
  }

  // Suggestion wording only once suggestions are in hand; manual mode says the member chooses;
  // until the answer names the mode (and when it failed) the copy is neutral.
  const titleKey = suggestions
    ? 'wardrobe.tagging.title'
    : isManualMode
      ? 'wardrobe.tagging.manual_title'
      : 'wardrobe.tagging.pending_title'
  const tagHint = suggestions
    ? t('wardrobe.tagging.desc')
    : isManualMode
      ? t('wardrobe.tagging.manual_desc')
      : t('wardrobe.tagging.pending_desc')

  const subtypeStrings = garmentSubtypeStrings(i18n.language)

  return (
    <EdgeToEdgeModal
      visible={visible}
      animationType={modalAnimation}
      onRequestClose={onClose}
      returnFocusRef={invokingNodeHandleRef}
      scrim={scrim}
    >
      <View style={styles.overlay}>
        <View
          testID="garment-tagging-modal"
          style={[styles.container, { paddingBottom: 20 + insets.bottom }]}
          accessibilityViewIsModal={true}
          onAccessibilityEscape={() => onCloseRef.current()}
        >
          {/* Story CC-7.11 D13: the header is the layer's swipe-down handle, through the same close. */}
          <LayerSwipeHandle style={styles.header}>
            <Text
              ref={titleRef}
              style={styles.title}
              accessible={true}
              accessibilityRole="header"
            >
              {t(titleKey)}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel={t('wardrobe.tagging.close')}
              accessibilityRole="button"
              testID="garment-tagging-close"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </LayerSwipeHandle>

          <TaggingError
            message={suggestionError}
            isLoading={isLoading}
            retryLabel={t('wardrobe.tagging.retry')}
            onRetry={() => setLoadAttempt((current) => current + 1)}
          />

          {saveError && (
            <Text style={styles.errorText} accessibilityRole="alert">
              {saveError}
            </Text>
          )}

          {isLoading && (
            <ActivityIndicator
              accessibilityLabel={t('wardrobe.tagging.loading')}
              size="large"
              color={colors.ink}
              style={styles.loading}
            />
          )}
          {!isAnalysisPending && (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.content}>
              {previewUrl && previewUrl !== failedPreviewUrl && (
                <Image
                  source={{ uri: previewUrl }}
                  onError={() => setFailedPreviewUrl(previewUrl)}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={copy.preview}
                  resizeMode="contain"
                  style={styles.preview}
                />
              )}
              {isManualMode && (
                <Text
                  style={styles.suggestionText}
                  testID="garment-tagging-manual-notice"
                >
                  {t('wardrobe.tagging.manual_desc')}
                </Text>
              )}
              {/* Category */}
              <Text style={styles.sectionTitle}>
                {t('wardrobe.tagging.category')} {t('wardrobe.tagging.required')}
              </Text>
              {suggestions && !selectedCategory && (
                <Text style={styles.suggestionText}>{copy.pickOne}</Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.category')}
                accessibilityHint={tagHint}
                style={styles.chipGrid}
              >
                {CATEGORY_OPTIONS.map((opt) => {
                  const isSelected = selectedCategory === opt
                  const label = t(`wardrobe.tagging.options.category.${opt}`)
                  return (
                    <TouchableOpacity
                      key={opt}
                      testID={`garment-tag-category-${opt}`}
                      accessibilityRole="radio"
                      aria-checked={isSelected}
                      aria-disabled={isSaving}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setChosenCategory(opt)
                        if (opt !== selectedCategory) setChosenSubtype(undefined)
                        announce('feedback', label)
                      }}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                    >
                      <Text
                        style={[styles.chipText, isSelected && styles.chipTextSelected]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {subtype.options.length > 0 && (
                <View testID="garment-tagging-subtype-picker">
                  <Text style={styles.sectionTitle}>{subtypeStrings.label}</Text>
                  {subtype.selected === undefined && (
                    <Text style={styles.suggestionText}>{copy.pickOne}</Text>
                  )}
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel={subtypeStrings.label}
                    style={styles.chipGrid}
                  >
                    {([null, ...subtype.options] as const).map((value) => {
                      const selected = displayedSubtype === value
                      const label = value
                        ? subtypeStrings.values[value]
                        : subtypeStrings.none
                      return (
                        <TouchableOpacity
                          key={value ?? 'none'}
                          testID={`garment-tagging-subtype-${value ?? 'none'}`}
                          accessibilityRole="radio"
                          aria-checked={selected}
                          aria-disabled={isSaving}
                          accessibilityLabel={label}
                          disabled={isSaving}
                          onPress={() => {
                            setChosenCategory(selectedCategory)
                            setChosenSubtype(value)
                            announce('feedback', label)
                          }}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
              )}

              {/* Material */}
              <Text style={styles.sectionTitle}>
                {t('wardrobe.tagging.material')}
                {!suggestions && ' ' + t('wardrobe.tagging.optional')}
              </Text>
              {suggestions && selectedMaterial === undefined && (
                <Text style={styles.suggestionText}>{copy.pickOne}</Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.material')}
                accessibilityHint={tagHint}
                style={styles.chipGrid}
              >
                <TouchableOpacity
                  accessibilityRole="radio"
                  aria-checked={selectedMaterial === null}
                  aria-disabled={isSaving}
                  accessibilityLabel={t('wardrobe.tagging.not_sure')}
                  disabled={isSaving}
                  onPress={() => {
                    setChosenMaterial(null)
                    announce('feedback', t('wardrobe.tagging.not_sure'))
                  }}
                  style={[styles.chip, selectedMaterial === null && styles.chipSelected]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedMaterial === null && styles.chipTextSelected,
                    ]}
                  >
                    {t('wardrobe.tagging.not_sure')}
                  </Text>
                </TouchableOpacity>
                {MATERIAL_OPTIONS.map((opt) => {
                  const isSelected = selectedMaterial === opt
                  const label = t(`wardrobe.tagging.options.material.${opt}`)
                  return (
                    <TouchableOpacity
                      key={opt}
                      testID={`garment-tag-material-${opt}`}
                      accessibilityRole="radio"
                      aria-checked={isSelected}
                      aria-disabled={isSaving}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setChosenMaterial(opt)
                        announce('feedback', label)
                      }}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                    >
                      <Text
                        style={[styles.chipText, isSelected && styles.chipTextSelected]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* Comfort Range */}
              <Text style={styles.sectionTitle}>
                {t('wardrobe.tagging.comfort_range')} {t('wardrobe.tagging.required')}
              </Text>
              {suggestions && !selectedComfort && (
                <Text style={styles.suggestionText}>{copy.pickOne}</Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.comfort_range')}
                accessibilityHint={tagHint}
                style={styles.comfortList}
              >
                {COMFORT_OPTIONS.map((opt) => {
                  const isSelected = selectedComfort === opt
                  const label = t(`wardrobe.tagging.options.comfort.${opt}`)
                  return (
                    <TouchableOpacity
                      key={opt}
                      testID={`garment-tag-comfort-${opt}`}
                      accessibilityRole="radio"
                      aria-checked={isSelected}
                      aria-disabled={isSaving}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setChosenComfort(opt)
                        announce('feedback', label)
                      }}
                      style={[
                        styles.comfortCard,
                        isSelected && styles.comfortCardSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.comfortText,
                          isSelected && styles.chipTextSelected,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelBtn}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            {!isAnalysisPending && (
              <TouchableOpacity
                onPress={() => void handleSave()}
                disabled={isSaveDisabled}
                style={[styles.saveBtn, isSaveDisabled && styles.saveBtnDisabled]}
                accessibilityRole="button"
                aria-disabled={isSaveDisabled}
                testID="garment-tagging-save"
              >
                <Text style={styles.saveText}>
                  {isSaving
                    ? t('wardrobe.tagging.saving')
                    : suggestions
                      ? copy.looksRight
                      : t('wardrobe.tagging.save')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </EdgeToEdgeModal>
  )
}

/** The sheet's layout, in the OS light/dark colors. */
const useStyles = createSchemeStyles((colors) => ({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.page,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.ink,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    color: colors.inkMuted,
  },
  errorText: {
    color: colors.dangerInk,
    backgroundColor: colors.dangerSurface,
    padding: 12,
    borderRadius: 8,
    marginVertical: 12,
    fontSize: 14,
  },
  retryBtn: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: {
    color: colors.noticeInk,
    fontWeight: '700',
  },
  content: {
    marginVertical: 12,
  },
  loading: {
    marginTop: 12,
  },
  preview: {
    width: '100%',
    height: 128,
    borderRadius: 8,
    backgroundColor: colors.cardMuted,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 12,
    marginBottom: 8,
  },
  suggestionText: {
    color: colors.inkMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: colors.noticeLine,
    backgroundColor: colors.noticeSurface,
  },
  chipText: {
    fontSize: 14,
    color: colors.ink,
  },
  chipTextSelected: {
    fontWeight: 'bold',
    color: colors.ink,
  },
  comfortList: {
    gap: 8,
  },
  comfortCard: {
    minHeight: 44,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  comfortCardSelected: {
    borderColor: colors.noticeLine,
    backgroundColor: colors.noticeSurface,
  },
  comfortText: {
    fontSize: 14,
    color: colors.ink,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cancelBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  cancelText: {
    fontSize: 14,
    color: colors.inkMuted,
  },
  saveBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.inverse,
  },
  saveBtnDisabled: {
    backgroundColor: colors.line,
  },
  saveText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onInverse,
  },
}))
