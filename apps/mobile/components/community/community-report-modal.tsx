import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  communityReportReasonSchema,
  type CommunityFeedItem,
  type CommunityReportReason,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

/**
 * `hero-theme.ts` carries neither the premium gold accent nor the community
 * surface's merlot destructive colour, and this task may not extend it, so both
 * are derived here once and reported as a palette gap. Merlot is a fill with
 * white ink (10.2:1); it is never used as text on a dark ground.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'
const DESTRUCTIVE_MERLOT = '#7A1F2D'
const ON_DESTRUCTIVE = '#FFFFFF'

export interface CommunityReportModalProps {
  visible: boolean
  post: CommunityFeedItem | null
  /** Already translated by the screen, which owns the failure-reason mapping. */
  errorMessage?: string | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (
    postId: string,
    reason: CommunityReportReason,
    details?: string
  ) => void | Promise<void>
}

export function CommunityReportModal({
  visible,
  post,
  errorMessage = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: CommunityReportModalProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  const [selectedReason, setSelectedReason] = useState<CommunityReportReason | null>(null)
  const [details, setDetails] = useState('')
  const dialogRef = useRef<View>(null)

  useEffect(() => {
    if (!visible) {
      setSelectedReason(null)
      setDetails('')
      return
    }
    // Focus containment starts by moving the reader into the dialog; the screen
    // restores focus to the invoking card once the dialog closes.
    if (Platform.OS === 'web') {
      return
    }
    const frame = requestAnimationFrame(() => {
      const node = safeFindNodeHandle(dialogRef.current)
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  const handleSubmit = useCallback(() => {
    if (!post || !selectedReason) {
      return
    }
    void onSubmit(post.id, selectedReason, details.trim() || undefined)
  }, [details, onSubmit, post, selectedReason])

  const isSubmitDisabled = !selectedReason || isSubmitting

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="community-report-modal"
    >
      <View style={styles.overlay}>
        <View
          ref={dialogRef}
          accessibilityViewIsModal
          accessibilityLabel={t('community.report.title')}
          style={[
            styles.container,
            { backgroundColor: palette.surface, borderColor: palette.divider },
          ]}
        >
          <Text style={[styles.title, { color: palette.text }]}>
            {t('community.report.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.mutedText }]}>
            {t('community.report.description')}
          </Text>

          <ScrollView style={styles.reasonsList} keyboardShouldPersistTaps="handled">
            <Text style={[styles.groupLabel, { color: palette.text }]}>
              {t('community.report.reasonLabel')}
            </Text>

            <View accessibilityRole="radiogroup">
              {communityReportReasonSchema.options.map((reason) => {
                const isSelected = selectedReason === reason
                const label = t(`community.report.reason.${reason}`)
                return (
                  <TouchableOpacity
                    key={reason}
                    testID={`report-reason-${reason}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    // `accessibilityState` is native-only: react-native-web's
                    // forwardedProps table has no entry for the object form, so on
                    // the web target (`app.json` ships one) this radio rendered with
                    // no `aria-checked` at all and axe failed `aria-required-attr`.
                    // RN 0.81 accepts the `aria-*` props directly on both platforms.
                    aria-checked={isSelected}
                    accessibilityLabel={label}
                    style={[
                      styles.reasonOption,
                      { borderColor: isSelected ? palette.text : 'transparent' },
                    ]}
                    onPress={() => setSelectedReason(reason)}
                  >
                    <View
                      style={[
                        styles.radioCircle,
                        {
                          // 3:1 against the surface in both schemes, where the
                          // old #55555C on #222228 computed to 2.14:1.
                          borderColor: isSelected ? palette.text : palette.mutedText,
                          backgroundColor: isSelected ? ACCENT_GOLD : 'transparent',
                        },
                      ]}
                    >
                      {/* Shape, not colour: the check mark is what says selected. */}
                      {isSelected ? (
                        <Text style={[styles.radioCheck, { color: ON_ACCENT }]}>✓</Text>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.reasonLabel,
                        {
                          color: palette.text,
                          fontWeight: isSelected ? '700' : '400',
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={[styles.detailsLabel, { color: palette.text }]}>
              {t('community.report.detailsLabel')}
            </Text>
            <TextInput
              testID="report-details-input"
              style={[
                styles.detailsInput,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.mutedText,
                  color: palette.text,
                },
              ]}
              placeholder={t('community.report.detailsPlaceholder')}
              // 4.74:1 in light and 11.2:1 in dark, where #666666 on #121214
              // computed to 3.26:1 and failed 1.4.3.
              placeholderTextColor={palette.mutedText}
              accessibilityLabel={t('community.report.detailsLabel')}
              multiline
              maxLength={500}
              value={details}
              onChangeText={setDetails}
            />
            <Text
              style={[styles.detailsCount, { color: palette.mutedText }]}
              testID="report-details-count"
            >
              {t('community.report.detailsCount', { count: details.length })}
            </Text>

            {errorMessage ? (
              <View
                testID="report-error-message"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={[styles.errorPanel, { backgroundColor: DESTRUCTIVE_MERLOT }]}
              >
                <Text style={[styles.errorText, { color: ON_DESTRUCTIVE }]}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              testID="cancel-report-button"
              accessibilityRole="button"
              accessibilityLabel={t('community.report.cancel')}
              style={[styles.cancelButton, { borderColor: palette.mutedText }]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={[styles.cancelButtonText, { color: palette.text }]}>
                {t('community.report.cancel')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="submit-report-button"
              accessibilityRole="button"
              accessibilityLabel={
                isSubmitting
                  ? t('community.report.submitting')
                  : t('community.report.submit')
              }
              // Why the control is dead, spoken rather than implied by dimming.
              accessibilityHint={
                isSubmitDisabled ? t('community.report.reasonLabel') : undefined
              }
              accessibilityState={{ disabled: isSubmitDisabled, busy: isSubmitting }}
              style={[
                styles.submitButton,
                { backgroundColor: ACCENT_GOLD },
                isSubmitDisabled && styles.submitButtonDisabled,
              ]}
              disabled={isSubmitDisabled}
              onPress={handleSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={ON_ACCENT} />
              ) : (
                <Text style={[styles.submitButtonText, { color: ON_ACCENT }]}>
                  {t('community.report.submit')}
                </Text>
              )}
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    padding: 20,
    borderWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  reasonsList: {
    maxHeight: 340,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
    minHeight: 44,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioCheck: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  reasonLabel: {
    fontSize: 13,
    flex: 1,
  },
  detailsLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  detailsInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  detailsCount: {
    fontSize: 11,
    marginTop: 4,
  },
  errorPanel: {
    marginTop: 12,
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 120,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
})
