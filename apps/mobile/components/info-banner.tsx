// Story 3.7 Task 4 step 2 owner: implement mobile reusable info banner for invalid deep link notifications
import React, { forwardRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

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
      style={styles.container}
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
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>i</Text>
        </View>
        <Text style={styles.messageText}>{message}</Text>
      </View>
      <Pressable
        onPress={handleDismiss}
        accessibilityLabel={t('common.dismiss_banner')}
        accessibilityRole="button"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.closeButton}
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 14,
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201, 161, 74, 0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: { elevation: 5 },
      web: { boxShadow: '0 2px 4px rgba(0, 0, 0, 0.25)' },
    }),
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
    borderRadius: 11,
    backgroundColor: 'rgba(201, 161, 74, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconText: {
    color: '#C9A14A',
    fontWeight: 'bold',
    fontSize: 12,
  },
  messageText: {
    color: '#F5F5F7',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    color: '#F5F5F7',
    fontSize: 16,
  },
})
