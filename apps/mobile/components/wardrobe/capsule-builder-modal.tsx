import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { randomUuidV4 } from '@/src/lib/uuid'
import {
  AccessibilityInfo,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native'
import type {
  CapsuleOccasion,
  CreateOutfitCapsuleInput,
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

export interface MobileCapsuleSaveOptions {
  /** Present only when editing; the current strong entity tag. */
  ifMatch?: string
  /** Stable for the lifetime of this modal so retries cannot duplicate. */
  idempotencyKey: string
}

export interface MobileCapsuleBuilderModalProps {
  visible: boolean
  onClose: () => void
  onSave: (
    input: CreateOutfitCapsuleInput,
    options: MobileCapsuleSaveOptions
  ) => Promise<void>
  availableGarments: GarmentItemContract[]
  initialCapsule?: OutfitCapsuleContract | null
  /** Focus returns here on close, which is why the handle is retained. */
  invokingNodeHandle?: number | null
}

const MIN_GARMENTS = 2
const MAX_GARMENTS = 10

/** Distinguishes two garments of the same category for screen-reader users. */
function describeGarment(
  garment: GarmentItemContract | undefined,
  position: number
): string {
  if (!garment) {
    return `Garment ${position}`
  }
  const category = garment.category ?? 'garment'
  const comfort = garment.comfortRange ? `, ${garment.comfortRange}` : ''
  return `${category}${comfort} (position ${position})`
}

const ALL_OCCASIONS: CapsuleOccasion[] = [
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
]

export function MobileCapsuleBuilderModal({
  visible,
  onClose,
  onSave,
  availableGarments,
  initialCapsule,
  invokingNodeHandle,
}: MobileCapsuleBuilderModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedOccasions, setSelectedOccasions] = useState<CapsuleOccasion[]>([
    'casual',
  ])
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([])
  const [isFavorite, setIsFavorite] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const titleRef = useRef<Text | null>(null)
  const reorderNodeHandles = useRef<Record<string, number | null>>({})

  useEffect(() => {
    if (visible) {
      if (initialCapsule) {
        setName(initialCapsule.name)
        setDescription(initialCapsule.description ?? '')
        setSelectedOccasions(initialCapsule.occasions)
        setSelectedGarmentIds(initialCapsule.garments.map((g) => g.id))
        setIsFavorite(initialCapsule.isFavorite)
      } else {
        setName('')
        setDescription('')
        setSelectedOccasions(['casual'])
        setSelectedGarmentIds([])
        setIsFavorite(false)
      }
      setErrorMessage(null)
      setIsSubmitting(false)
      /**
       * One key per open form, reused across every retry of this submission.
       *
       * The API requires a UUID v4 and rejects anything else with
       * `400 Idempotency-Key must be a UUID v4`. Hermes ships no
       * `globalThis.crypto.randomUUID`, so the old
       * `${Date.now()}-${Math.random()}` fallback fired on every real device and
       * produced a string that is not a UUID at all -- saving a capsule from the
       * app failed outright, and only ever succeeded in jsdom, where
       * `globalThis.crypto` happens to exist. See `src/lib/uuid.ts`.
       */
      setIdempotencyKey(randomUuidV4())

      if (titleRef.current && Platform.OS !== 'web') {
        const handle = safeFindNodeHandle(titleRef.current)
        if (handle) {
          AccessibilityInfo.setAccessibilityFocus(handle)
        }
      }
    }
    /**
     * Keying this on `availableGarments` meant any background refetch produced a
     * new array identity, wiped the form mid-edit, and yanked accessibility
     * focus back to the heading.
     */
  }, [visible, initialCapsule])

  /** Focus returns to the control that opened the sheet, as the AC requires. */
  useEffect(() => {
    if (visible || Platform.OS === 'web' || !invokingNodeHandle) {
      return
    }
    AccessibilityInfo.setAccessibilityFocus(invokingNodeHandle)
  }, [visible, invokingNodeHandle])

  const toggleGarment = (id: string) => {
    if (selectedGarmentIds.includes(id)) {
      /**
       * Deselecting below the minimum is allowed. Blocking it made a two-garment
       * capsule impossible to repair: the user could never swap a garment out.
       */
      setSelectedGarmentIds(selectedGarmentIds.filter((gId) => gId !== id))
    } else {
      if (selectedGarmentIds.length >= MAX_GARMENTS) {
        setErrorMessage(t('wardrobe.capsules.errors.garmentCount'))
        return
      }
      setSelectedGarmentIds([...selectedGarmentIds, id])
    }
    setErrorMessage(null)
  }

  const toggleOccasion = (occ: CapsuleOccasion) => {
    if (selectedOccasions.includes(occ)) {
      if (selectedOccasions.length <= 1) {
        setErrorMessage(t('wardrobe.capsules.errors.occasionRequired'))
        return
      }
      setSelectedOccasions(selectedOccasions.filter((o) => o !== occ))
    } else {
      setSelectedOccasions([...selectedOccasions, occ])
    }
    setErrorMessage(null)
  }

  const moveGarment = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= selectedGarmentIds.length) return

    const updated = [...selectedGarmentIds]
    const temp = updated[index]!
    updated[index] = updated[targetIndex]!
    updated[targetIndex] = temp
    setSelectedGarmentIds(updated)

    const garment = availableGarments.find((g) => g.id === temp)
    const label = describeGarment(garment, targetIndex + 1)
    AccessibilityInfo.announceForAccessibility(
      t('wardrobe.capsules.garmentMoved', {
        garment: label,
        position: targetIndex + 1,
        count: updated.length,
      })
    )

    /**
     * Keep accessibility focus on the moved row's control. At a boundary that
     * control becomes disabled, so focus moves to the opposite one rather than
     * being lost entirely.
     */
    const atBoundary = targetIndex === 0 || targetIndex === updated.length - 1
    const focusDirection = atBoundary ? (direction === 'up' ? 'down' : 'up') : direction
    const node = reorderNodeHandles.current[`${focusDirection}-${temp}`]
    if (node && Platform.OS !== 'web') {
      AccessibilityInfo.setAccessibilityFocus(node)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setErrorMessage(t('wardrobe.capsules.errors.nameRequired'))
      return
    }
    if (
      selectedGarmentIds.length < MIN_GARMENTS ||
      selectedGarmentIds.length > MAX_GARMENTS
    ) {
      setErrorMessage(t('wardrobe.capsules.errors.garmentCount'))
      return
    }
    if (selectedOccasions.length === 0) {
      setErrorMessage(t('wardrobe.capsules.errors.occasionRequired'))
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      await onSave(
        {
          name: name.trim(),
          /**
           * An emptied description sends `null`. Sending `undefined` drops the
           * field from the PATCH body, which the server reads as "leave
           * unchanged" and makes the description unclearable.
           */
          description: description.trim() === '' ? null : description.trim(),
          occasions: selectedOccasions,
          garmentIds: selectedGarmentIds,
          isFavorite,
        },
        {
          ifMatch: initialCapsule
            ? `"capsule:${initialCapsule.id}:${initialCapsule.revision}"`
            : undefined,
          idempotencyKey,
        }
      )
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('wardrobe.capsules.errors.save')
      setErrorMessage(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer} testID="mobile-capsule-builder-container">
          <View style={styles.header}>
            <Text
              ref={titleRef}
              style={styles.title}
              accessibilityRole="header"
              testID="capsule-modal-title"
            >
              {initialCapsule
                ? t('wardrobe.capsules.edit')
                : t('wardrobe.capsules.create')}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close capsule builder modal"
              testID="close-modal-button"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {errorMessage && (
            <View
              style={styles.errorBox}
              testID="capsule-error-box"
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
            {(initialCapsule?.unavailableGarmentCount ?? 0) > 0 && (
              <View style={styles.repairBox} testID="capsule-repair-banner">
                <Text style={styles.repairText}>
                  {initialCapsule?.unavailableGarmentCount === 1
                    ? '1 garment is no longer available and has been removed. Choose a replacement before saving.'
                    : `${initialCapsule?.unavailableGarmentCount} garments are no longer available and have been removed. Choose replacements before saving.`}
                </Text>
              </View>
            )}

            <Text style={styles.label}>{t('wardrobe.capsules.nameLabel')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={60}
              placeholder={t('wardrobe.capsules.namePlaceholder')}
              style={styles.input}
              testID="capsule-name-input"
            />

            <Text style={styles.label}>{t('wardrobe.capsules.descriptionLabel')}</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              maxLength={280}
              multiline
              placeholder={t('wardrobe.capsules.descriptionPlaceholder')}
              style={[styles.input, styles.multilineInput]}
              testID="capsule-desc-input"
            />

            <Text style={styles.label}>{t('wardrobe.capsules.occasionsLabel')}</Text>
            <View style={styles.chipGrid}>
              {ALL_OCCASIONS.map((occ) => {
                const isSelected = selectedOccasions.includes(occ)
                return (
                  <TouchableOpacity
                    key={occ}
                    onPress={() => toggleOccasion(occ)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={t(`wardrobe.capsules.occasions.${occ}`)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    testID={`occasion-chip-${occ}`}
                  >
                    <Text
                      style={[styles.chipText, isSelected && styles.chipTextSelected]}
                    >
                      {t(`wardrobe.capsules.occasions.${occ}`)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/*
              One interpolated key rather than a translated word with an
              English tail. This used to concatenate `garmentsLabel` with a
              hardcoded "(N of M selected)", so every non-English locale shipped
              a half-translated label -- on device, Turkish rendered literally as
              "Parçalar (0 of 10 selected)". Word order around the count also
              differs by language, which concatenation cannot express.
            */}
            <Text style={styles.label}>
              {t('wardrobe.capsules.garmentsSelected', {
                count: selectedGarmentIds.length,
                max: MAX_GARMENTS,
              })}
            </Text>
            <View style={styles.garmentListContainer}>
              {availableGarments.map((g) => {
                const isSelected = selectedGarmentIds.includes(g.id)
                return (
                  <TouchableOpacity
                    key={g.id}
                    onPress={() => toggleGarment(g.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={`${g.category ?? 'Garment'} ${g.comfortRange ?? 'mild'}`}
                    style={styles.garmentRow}
                    testID={`garment-checkbox-${g.id}`}
                  >
                    <Text style={styles.garmentText}>
                      {isSelected ? '[✓] ' : '[  ] '}
                      {g.category ?? 'Garment'} ({g.comfortRange ?? 'mild'})
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {selectedGarmentIds.length > 0 && (
              <View style={styles.reorderSection}>
                {/*
                  Was a bare literal with no `t()` call at all, so this heading
                  shipped in English in all ten locales -- the same defect class
                  as the garment count above it, found in the same component.
                */}
                <Text style={styles.label}>{t('wardrobe.capsules.garmentOrder')}</Text>
                {selectedGarmentIds.map((gId, idx) => {
                  const g = availableGarments.find((garment) => garment.id === gId)
                  const label = describeGarment(g, idx + 1)
                  const isFirst = idx === 0
                  const isLast = idx === selectedGarmentIds.length - 1
                  return (
                    <View
                      key={gId}
                      style={styles.reorderRow}
                      testID={`reorder-row-${gId}`}
                    >
                      <Text style={styles.reorderText}>
                        {idx + 1}. {g?.category ?? 'Garment'}
                      </Text>
                      <View style={styles.reorderButtons}>
                        <TouchableOpacity
                          ref={(node) => {
                            reorderNodeHandles.current[`up-${gId}`] =
                              safeFindNodeHandle(node)
                          }}
                          onPress={() => moveGarment(idx, 'up')}
                          disabled={isFirst}
                          accessibilityRole="button"
                          /** Announced as disabled so the boundary is perceivable. */
                          accessibilityState={{ disabled: isFirst }}
                          accessibilityLabel={t('wardrobe.capsules.moveGarmentUp', {
                            garment: label,
                          })}
                          style={[styles.reorderBtn, isFirst && styles.btnDisabled]}
                          testID={`move-up-button-${gId}`}
                        >
                          <Text style={styles.reorderBtnText}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          ref={(node) => {
                            reorderNodeHandles.current[`down-${gId}`] =
                              safeFindNodeHandle(node)
                          }}
                          onPress={() => moveGarment(idx, 'down')}
                          disabled={isLast}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: isLast }}
                          accessibilityLabel={t('wardrobe.capsules.moveGarmentDown', {
                            garment: label,
                          })}
                          style={[styles.reorderBtn, isLast && styles.btnDisabled]}
                          testID={`move-down-button-${gId}`}
                        >
                          <Text style={styles.reorderBtnText}>▼</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

            <TouchableOpacity
              onPress={() => setIsFavorite(!isFavorite)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isFavorite }}
              accessibilityLabel={t('wardrobe.capsules.favoriteLabel')}
              style={styles.favoriteRow}
              testID="favorite-toggle"
            >
              <Text style={styles.favoriteText}>
                {isFavorite ? '★ Favorite Capsule' : '☆ Mark as Favorite'}
              </Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                void handleSubmit()
              }}
              disabled={isSubmitting}
              style={[styles.saveButton, isSubmitting && styles.btnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('wardrobe.capsules.save')}
              testID="save-capsule-button"
            >
              <Text style={styles.saveText}>
                {isSubmitting ? 'Saving...' : 'Save Capsule'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111',
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    color: '#666',
  },
  repairBox: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    marginBottom: 12,
    padding: 12,
  },
  repairText: {
    color: '#78350f',
    fontSize: 12,
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '500',
  },
  content: {
    marginTop: 12,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#111',
  },
  multilineInput: {
    height: 60,
    textAlignVertical: 'top',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  chipText: {
    fontSize: 12,
    color: '#333',
    textTransform: 'capitalize',
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  garmentListContainer: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    maxHeight: 180,
  },
  garmentRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    minHeight: 44,
    justifyContent: 'center',
  },
  garmentText: {
    fontSize: 14,
    color: '#222',
  },
  reorderSection: {
    marginTop: 12,
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  reorderText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  reorderBtn: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderBtnText: {
    fontSize: 12,
  },
  favoriteRow: {
    marginTop: 16,
    paddingVertical: 12,
  },
  favoriteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  cancelButton: {
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
    color: '#444',
  },
  saveButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#111',
  },
  saveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.4,
  },
})
