import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { EmbeddedCommunityChallenge } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

export interface CommunityChallengeBannerProps {
  challenge: EmbeddedCommunityChallenge
  onParticipate: (opener: View | null) => void
  onDismiss: () => void
}

export function CommunityChallengeBanner({
  challenge,
  onParticipate,
  onDismiss,
}: CommunityChallengeBannerProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View
      testID="community-challenge-banner"
      style={[
        styles.banner,
        { backgroundColor: palette.card, borderColor: palette.line },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.ink }]}
        testID="community-challenge-title"
      >
        {t('community.calm.thisWeek', { title: challenge.title })}
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          testID="community-challenge-cta"
          accessibilityRole="button"
          accessibilityLabel={t('community.challenge.participateLabel', {
            title: challenge.title,
          })}
          style={styles.button}
          onPress={(event) =>
            onParticipate(event.currentTarget as unknown as View | null)
          }
        >
          <Text style={[styles.ctaText, { color: palette.ink }]}>
            {t('community.challenge.participate')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="community-challenge-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t('community.calm.dismissChallenge')}
          style={styles.button}
          onPress={onDismiss}
        >
          <Text style={[styles.dismiss, { color: palette.inkMuted }]}>×</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  title: { flexGrow: 1, flexShrink: 1, fontSize: 14, fontWeight: '600' },
  actions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    flexShrink: 1,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  dismiss: { fontSize: 24 },
})
