// Story 4.2 Task 8 step 1 owner: implement native mobile garment tagging modal component in apps/mobile/components/wardrobe/garment-tagging-modal.tsx
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  BackHandler,
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  findNodeHandle,
} from 'react-native'
import type {
  GarmentCategory,
  GarmentMaterial,
  GarmentComfortRange,
  GarmentItemContract,
  SuggestGarmentTagsData,
} from '@couture/api-client/contracts/http'
import {
  suggestGarmentTagsFromMobile,
  updateGarmentTagsFromMobile,
} from '../../src/lib/wardrobe'
import { useAccessibilityAnnouncer } from '../../src/hooks/use-accessibility-announcer'

export interface MobileGarmentTaggingModalProps {
  visible: boolean
  onClose: () => void
  garmentId: string | null
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
    tags: {
      category: GarmentCategory
      material?: GarmentMaterial | null
      comfortRange: GarmentComfortRange
    },
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
  accessToken,
  onTagsConfirmed,
  suggestTagsFn = suggestGarmentTagsFromMobile,
  updateTagsFn = updateGarmentTagsFromMobile,
  invokingNodeHandle,
}: MobileGarmentTaggingModalProps) {
  const { t } = useTranslation()
  const { announce } = useAccessibilityAnnouncer()
  const [selectedCategory, setSelectedCategory] = useState<GarmentCategory | null>(null)
  const [selectedMaterial, setSelectedMaterial] = useState<GarmentMaterial | null>(null)
  const [selectedComfort, setSelectedComfort] = useState<GarmentComfortRange | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isAnalysisPending, setIsAnalysisPending] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestGarmentTagsData | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const titleRef = useRef<React.ElementRef<typeof Text> | null>(null)
  const saveAbortRef = useRef<AbortController | null>(null)
  const onCloseRef = useRef(onClose)
  const invokingNodeHandleRef = useRef(invokingNodeHandle)
  const modalSessionRef = useRef(0)
  onCloseRef.current = onClose
  invokingNodeHandleRef.current = invokingNodeHandle

  useEffect(() => {
    if (!visible) return
    const focusTimer = setTimeout(() => {
      const node = findNodeHandle(titleRef.current)
      if (node) AccessibilityInfo.setAccessibilityFocus(node)
    }, 150)
    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current()
      return true
    })
    return () => {
      clearTimeout(focusTimer)
      backSubscription.remove()
      const invoker = invokingNodeHandleRef.current
      if (invoker) {
        AccessibilityInfo.setAccessibilityFocus(invoker)
      }
    }
  }, [visible])

  useEffect(() => {
    modalSessionRef.current += 1
  }, [garmentId, visible])

  useEffect(
    () => () => {
      saveAbortRef.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (!visible || !garmentId) {
      setSelectedCategory(null)
      setSelectedMaterial(null)
      setSelectedComfort(null)
      setSuggestions(null)
      setSuggestionError(null)
      setSaveError(null)
      setIsAnalysisPending(false)
      return
    }

    const controller = new AbortController()
    let isMounted = true
    setSelectedCategory(null)
    setSelectedMaterial(null)
    setSelectedComfort(null)
    setSuggestions(null)
    setIsLoading(true)
    setSuggestionError(null)
    setSaveError(null)
    setIsAnalysisPending(false)

    announce('feedback', t('wardrobe.tagging.loading_suggestions'))
    suggestTagsFn(accessToken, garmentId, controller.signal)
      .then((data) => {
        if (!isMounted) return
        setSuggestions(data)
        if (data.suggestions.category.isConfident) {
          setSelectedCategory(data.suggestions.category.value)
        }
        if (data.suggestions.material.isConfident) {
          setSelectedMaterial(data.suggestions.material.value)
        }
        if (data.suggestions.comfortRange.isConfident) {
          setSelectedComfort(data.suggestions.comfortRange.value)
        }
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

  const handleSave = async () => {
    if (!garmentId || !selectedCategory || !selectedComfort) {
      const message = t('wardrobe.tagging.selection_required')
      setSaveError(message)
      announce('error', message)
      return
    }

    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    saveAbortRef.current = controller
    const modalSession = modalSessionRef.current

    try {
      const updated = await updateTagsFn(
        accessToken,
        garmentId,
        {
          category: selectedCategory,
          material: selectedMaterial,
          comfortRange: selectedComfort,
        },
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

  const isSaveDisabled =
    !selectedCategory || !selectedComfort || isSaving || isAnalysisPending

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          testID="garment-tagging-modal"
          style={styles.container}
          accessibilityViewIsModal={true}
          onAccessibilityEscape={() => onCloseRef.current()}
        >
          <View style={styles.header}>
            <Text
              ref={titleRef}
              style={styles.title}
              accessible={true}
              accessibilityRole="header"
            >
              {t('wardrobe.tagging.title')}
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
          </View>

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

          {isLoading ? (
            <ActivityIndicator
              accessibilityLabel={t('wardrobe.tagging.loading_suggestions')}
              size="large"
              color="#000"
              style={{ marginVertical: 20 }}
            />
          ) : !isAnalysisPending ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.content}>
              {/* Category */}
              <Text style={styles.sectionTitle}>
                {t('wardrobe.tagging.category')} {t('wardrobe.tagging.required')}
              </Text>
              {suggestions && (
                <Text style={styles.suggestionText}>
                  {t(
                    suggestions.suggestions.category.isConfident
                      ? 'wardrobe.tagging.ai_suggested'
                      : 'wardrobe.tagging.low_confidence_suggested',
                    {
                      value: t(
                        `wardrobe.tagging.options.category.${suggestions.suggestions.category.value}`
                      ),
                    }
                  )}
                </Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.category')}
                accessibilityHint={t('wardrobe.tagging.desc')}
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
                      accessibilityState={{ selected: isSelected, disabled: isSaving }}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setSelectedCategory(opt)
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

              {/* Material */}
              <Text style={styles.sectionTitle}>
                {t('wardrobe.tagging.material')} {t('wardrobe.tagging.optional')}
              </Text>
              {suggestions && (
                <Text style={styles.suggestionText}>
                  {t(
                    suggestions.suggestions.material.isConfident
                      ? 'wardrobe.tagging.ai_suggested'
                      : 'wardrobe.tagging.low_confidence_suggested',
                    {
                      value: t(
                        `wardrobe.tagging.options.material.${suggestions.suggestions.material.value}`
                      ),
                    }
                  )}
                </Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.material')}
                accessibilityHint={t('wardrobe.tagging.desc')}
                style={styles.chipGrid}
              >
                <TouchableOpacity
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: selectedMaterial === null,
                    disabled: isSaving,
                  }}
                  accessibilityLabel={t('wardrobe.tagging.not_sure')}
                  disabled={isSaving}
                  onPress={() => {
                    setSelectedMaterial(null)
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
                      accessibilityState={{ selected: isSelected, disabled: isSaving }}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setSelectedMaterial(opt)
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
              {suggestions && (
                <Text style={styles.suggestionText}>
                  {t(
                    suggestions.suggestions.comfortRange.isConfident
                      ? 'wardrobe.tagging.ai_suggested'
                      : 'wardrobe.tagging.low_confidence_suggested',
                    {
                      value: t(
                        `wardrobe.tagging.options.comfort.${suggestions.suggestions.comfortRange.value}`
                      ),
                    }
                  )}
                </Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('wardrobe.tagging.comfort_range')}
                accessibilityHint={t('wardrobe.tagging.desc')}
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
                      accessibilityState={{ selected: isSelected, disabled: isSaving }}
                      accessibilityLabel={label}
                      disabled={isSaving}
                      onPress={() => {
                        setSelectedComfort(opt)
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
          ) : null}

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
                accessibilityState={{ disabled: isSaveDisabled }}
                testID="garment-tagging-save"
              >
                <Text style={styles.saveText}>
                  {isSaving ? t('wardrobe.tagging.saving') : t('wardrobe.tagging.save')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#fff',
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
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111',
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    color: '#666',
  },
  errorText: {
    color: '#d32f2f',
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
    fontSize: 14,
  },
  retryBtn: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: {
    color: '#8A5A00',
    fontWeight: '700',
  },
  content: {
    marginVertical: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
    marginBottom: 8,
  },
  suggestionText: {
    color: '#556B2F',
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
    borderColor: '#ccc',
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: '#c5a059',
    backgroundColor: '#fef9ef',
  },
  chipText: {
    fontSize: 13,
    color: '#333',
  },
  chipTextSelected: {
    fontWeight: 'bold',
    color: '#111',
  },
  comfortList: {
    gap: 8,
  },
  comfortCard: {
    minHeight: 44,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
  },
  comfortCardSelected: {
    borderColor: '#c5a059',
    backgroundColor: '#fef9ef',
  },
  comfortText: {
    fontSize: 14,
    color: '#333',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  cancelBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  cancelText: {
    fontSize: 14,
    color: '#555',
  },
  saveBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#111',
  },
  saveBtnDisabled: {
    backgroundColor: '#ccc',
  },
  saveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
})
