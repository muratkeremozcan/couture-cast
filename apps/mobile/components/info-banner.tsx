// Story 3.7 Task 4 step 2 owner: implement mobile reusable info banner for invalid deep link notifications
import React, { forwardRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useGlyphBox } from '@/components/glyph-box'
import { elevationStyle, useTokens } from '@/src/theme/tokens'

export interface InfoBannerProps {
  message: string
  onDismiss?: () => void
  /**
   * Story 6.7: false turns the polite live region off. Only a notice that takes
   * focus uses it, because moving focus there is its single announcement.
   */
  liveRegion?: boolean
}

/**
 * One mounted instance carries every message: a new message shows again even
 * after the previous one was dismissed, without remounting the region. The ref
 * names the message element, so a caller can move accessibility focus to it.
 */
export const InfoBanner = forwardRef<View, InfoBannerProps>(function InfoBanner(
  { message, onDismiss, liveRegion = true },
  ref
) {
  const { t } = useTranslation()
  const iconBox = useGlyphBox(22, true)
  const { colors } = useTokens()
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)

  if (dismissedMessage === message) {
    return null
  }

  const handleDismiss = () => {
    setDismissedMessage(message)
    if (onDismiss) {
      onDismiss()
    }
  }

  return (
    <View
      accessibilityLiveRegion={liveRegion ? 'polite' : 'none'}
      accessibilityLabel={message}
      testID="deep-link-info-banner"
      style={[
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.line },
      ]}
    >
      <View
        ref={ref}
        testID="deep-link-info-banner-message"
        accessible
        accessibilityLabel={message}
        // Focusable from code on web without becoming a tab stop.
        {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})}
        style={styles.content}
      >
        <View
          style={[styles.iconContainer, iconBox, { backgroundColor: colors.inverse }]}
        >
          <Text style={[styles.iconText, { color: colors.onInverse }]}>i</Text>
        </View>
        <Text style={[styles.messageText, { color: colors.ink }]}>{message}</Text>
      </View>
      <Pressable
        onPress={handleDismiss}
        accessibilityLabel={t('common.dismiss_banner')}
        accessibilityRole="button"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.closeButton}
      >
        <Text style={[styles.closeText, { color: colors.ink }]}>✕</Text>
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    // Colors follow the OS scheme at render time (Story CC-7.9 D2); the sheet keeps layout.
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...elevationStyle('card'),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  iconContainer: {
    width: 22,
    height: 22,
    borderRadius: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  iconText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  messageText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
  },
})
