import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export interface InfoBannerProps {
  message: string
  onDismiss?: () => void
}

export function InfoBanner({ message, onDismiss }: InfoBannerProps) {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) {
    return null
  }

  const handleDismiss = () => {
    setIsVisible(false)
    if (onDismiss) {
      onDismiss()
    }
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="deep-link-info-banner"
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>i</Text>
        </View>
        <Text style={styles.messageText}>{message}</Text>
      </View>
      <Pressable
        onPress={handleDismiss}
        accessibilityLabel="Dismiss banner"
        accessibilityRole="button"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.closeButton}
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  )
}

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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
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
