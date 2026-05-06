import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { Link } from 'expo-router'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import {
  MobileAnalyticsDiagnosticsPanel,
  isMobileAnalyticsDiagnosticsEnabled,
} from '@/src/analytics/mobile-analytics-diagnostics'
import {
  trackMobileRitualCreated,
  trackMobileWardrobeUploadStarted,
} from '@/src/analytics/track-events'

export default function TabOneScreen() {
  const analytics = useMobileAnalytics()
  const analyticsUserId = analytics.getDistinctId() || 'mobile-anonymous-user'
  const locationId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'

  // Track when user views Tab One — top of the engagement funnel
  // @see https://posthog.com/docs/libraries/react-native#capturing-events
  useEffect(() => {
    analytics.capture('tab_one_viewed')
  }, [analytics])

  const handleGenerateOutfit = () => {
    trackMobileRitualCreated(analytics, {
      userId: analyticsUserId,
      locationId,
      ritualType: 'daily_outfit',
      weatherContext: 'in_app_generation',
    })
  }

  const handleWardrobeUpload = async () => {
    if (isMobileAnalyticsDiagnosticsEnabled) {
      trackMobileWardrobeUploadStarted(analytics, {
        userId: analyticsUserId,
        itemId: 'maestro-analytics-upload',
        fileSize: 2048,
        itemCount: 1,
        uploadSource: 'maestro_diagnostics',
      })
      return
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      return
    }

    const pickResult = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      quality: 0.9,
    })

    if (pickResult.canceled) {
      return
    }

    const asset = pickResult.assets[0]
    if (!asset?.uri) {
      return
    }

    const fileInfo = await FileSystem.getInfoAsync(asset.uri)
    const fileSize =
      asset.fileSize ?? (fileInfo.exists && !fileInfo.isDirectory ? fileInfo.size : 0)
    if (!fileSize || fileSize <= 0) {
      return
    }

    trackMobileWardrobeUploadStarted(analytics, {
      userId: analyticsUserId,
      itemId: asset.fileName ?? `mobile-upload-${Date.now()}`,
      fileSize,
      itemCount: 1,
      uploadSource: 'image_library',
    })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab One</Text>
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/(tabs)/index.tsx" />
      <View style={styles.actions}>
        <Link href={'/signup' as never} asChild>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionText}>Open signup flow</Text>
          </Pressable>
        </Link>
        <Pressable style={styles.actionButton} onPress={handleGenerateOutfit}>
          <Text style={styles.actionText}>Generate outfit ritual</Text>
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={() => {
            void handleWardrobeUpload()
          }}
        >
          <Text style={styles.actionText}>Start wardrobe upload</Text>
        </Pressable>
      </View>
      <MobileAnalyticsDiagnosticsPanel />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
  actions: {
    marginTop: 16,
    width: '80%',
    gap: 12,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#a3a3a3',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
})
