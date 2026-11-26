import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import {
  EdgeToEdgeModal,
  useKeyboardOpen,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'
import { useTokens } from '@/src/theme/tokens'

// Story CC-7.9 D2, D3: every color is a role. The main action is `primary` (gold), a checked
// box is `inverse` with `onInverse`, and an error is the danger panel (`dangerSurface`,
// `dangerLine`, `dangerInk`), which meets 4.5:1 in both schemes.

export interface CommunityReportModalProps {
  suspended?: boolean
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
  suspended = false,
  post,
  errorMessage = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: CommunityReportModalProps) {
  const modalAnimation = useModalAnimation('fade')
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const { scrim } = useTokens()
  // R66: while the keyboard is up for the details field the reasons leave the layout,
  // so the lifted dialog shows the label, the field and its count whole, with no
  // reason row cut by the scroll edge. They return as the keyboard closes; the chosen
  // reason is kept either way.
  const [keyboardOpen] = useKeyboardOpen()
  const [detailsFocused, setDetailsFocused] = useState(false)
  const writingDetails = keyboardOpen && detailsFocused
  const insets = useModalInsets(keyboardOpen)

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
    <EdgeToEdgeModal
      visible={visible && !suspended}
      animationType={modalAnimation}
      onRequestClose={onClose}
      testID="community-report-modal"
      scrim={scrim}
      scrimTestID="community-report-modal-scrim"
    >
      <View
        testID="community-report-modal-overlay"
        style={[
          styles.overlay,
          { paddingTop: 20 + insets.top, paddingBottom: 20 + insets.bottom },
        ]}
      >
        <View
          ref={dialogRef}
          accessibilityViewIsModal
          accessibilityLabel={t('community.report.title')}
          style={[
            styles.container,
            { backgroundColor: palette.page, borderColor: palette.line },
          ]}
        >
          <Text style={[styles.title, { color: palette.ink }]}>
            {t('community.report.title')}
          </Text>
          <Text style={[styles.subtitle, { color: palette.inkMuted }]}>
            {t('community.report.description')}
          </Text>

          <ScrollView style={styles.reasonsList} keyboardShouldPersistTaps="handled">
            <View testID="report-reasons" style={writingDetails && styles.hidden}>
              <Text style={[styles.groupLabel, { color: palette.ink }]}>
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
                      aria-checked={isSelected}
                      accessibilityLabel={label}
                      style={[
                        styles.reasonOption,
                        { borderColor: isSelected ? palette.ink : 'transparent' },
                      ]}
                      onPress={() => setSelectedReason(reason)}
                    >
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            // 3:1 against the surface in both schemes, where the
                            // old #55555C on #222228 computed to 2.14:1.
                            borderColor: isSelected ? palette.ink : palette.inkMuted,
                            backgroundColor: isSelected ? palette.inverse : 'transparent',
                          },
                        ]}
                      >
                        {/* Shape, not colour: the check mark is what says selected. */}
                        {isSelected ? (
                          <Text style={[styles.radioCheck, { color: palette.onInverse }]}>
                            ✓
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.reasonLabel,
                          {
                            color: palette.ink,
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
            </View>

            <Text style={[styles.detailsLabel, { color: palette.ink }]}>
              {t('community.report.detailsLabel')}
            </Text>
            <TextInput
              testID="report-details-input"
              style={[
                styles.detailsInput,
                {
                  backgroundColor: palette.page,
                  borderColor: palette.inkMuted,
                  color: palette.ink,
                },
              ]}
              placeholder={t('community.report.detailsPlaceholder')}
              // 4.74:1 in light and 11.2:1 in dark, where #666666 on #121214
              // computed to 3.26:1 and failed 1.4.3.
              placeholderTextColor={palette.inkMuted}
              accessibilityLabel={t('community.report.detailsLabel')}
              multiline
              maxLength={500}
              value={details}
              onChangeText={setDetails}
              onFocus={() => setDetailsFocused(true)}
              onBlur={() => setDetailsFocused(false)}
            />
            <Text
              style={[styles.detailsCount, { color: palette.inkMuted }]}
              testID="report-details-count"
            >
              {t('community.report.detailsCount', { count: details.length })}
            </Text>

            {errorMessage ? (
              <View
                testID="report-error-message"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={[
                  styles.errorPanel,
                  {
                    backgroundColor: palette.dangerSurface,
                    borderColor: palette.dangerLine,
                  },
                ]}
              >
                <Text style={[styles.errorText, { color: palette.dangerInk }]}>
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
              style={[styles.cancelButton, { borderColor: palette.inkMuted }]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={[styles.cancelButtonText, { color: palette.ink }]}>
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
              aria-disabled={isSubmitDisabled}
              aria-busy={isSubmitting}
              style={[
                styles.submitButton,
                { backgroundColor: palette.primary },
                isSubmitDisabled && styles.submitButtonDisabled,
              ]}
              disabled={isSubmitDisabled}
              onPress={handleSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={palette.onPrimary} />
              ) : (
                <Text style={[styles.submitButtonText, { color: palette.onPrimary }]}>
                  {t('community.report.submit')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  reasonsList: {
    maxHeight: 340,
  },
  hidden: { display: 'none' },
  groupLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 44,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 9999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioCheck: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  reasonLabel: {
    fontSize: 14,
    flex: 1,
  },
  detailsLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  detailsInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  detailsCount: {
    fontSize: 12,
    marginTop: 4,
  },
  errorPanel: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
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
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '700',
  },
})
