import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { EmbeddedCommunityChallenge } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

/**
 * `hero-theme.ts` has no premium accent token and this task may not extend it, so
 * the gold badge/CTA colour and the ink on it are derived here. Reported as a
 * palette gap. `#111111` on `#C9A14A` computes to 8.7:1.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'

export interface CommunityChallengeBannerProps {
  challenge: EmbeddedCommunityChallenge
  onParticipate: () => void
}

export function CommunityChallengeBanner({
  challenge,
  onParticipate,
}: CommunityChallengeBannerProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  // One lookup keyed off the contract's own band values; no Title-Casing here.
  const climateLabel = challenge.climateBand
    ? t(`community.band.${challenge.climateBand}`)
    : t('community.challenge.allClimates')

  return (
    <View
      testID="community-challenge-banner"
      style={[
        styles.banner,
        { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.badgeContainer, { backgroundColor: ACCENT_GOLD }]}>
          <Text style={[styles.badgeText, { color: ON_ACCENT }]}>
            {t('community.challenge.eyebrow')}
          </Text>
        </View>
        <View style={[styles.climateTag, { borderColor: palette.mutedText }]}>
          <Text style={[styles.climateTagText, { color: palette.text }]}>
            {climateLabel}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.title, { color: palette.text }]}
        testID="community-challenge-title"
      >
        {challenge.title}
      </Text>
      <Text
        style={[styles.body, { color: palette.mutedText }]}
        testID="community-challenge-body"
      >
        {challenge.body}
      </Text>
      <TouchableOpacity
        testID="community-challenge-cta"
        accessibilityRole="button"
        accessibilityLabel={t('community.challenge.participateLabel', {
          title: challenge.title,
        })}
        style={[styles.ctaButton, { backgroundColor: ACCENT_GOLD }]}
        onPress={onParticipate}
      >
        <Text style={[styles.ctaButtonText, { color: ON_ACCENT }]}>
          {t('community.challenge.participate')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  climateTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  climateTagText: {
    fontSize: 11,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  ctaButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  ctaButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
})
