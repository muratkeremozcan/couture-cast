import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { EmbeddedCommunityChallenge } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

// Story CC-7.9 D3: the eyebrow badge is a marker (`inverse`) and Participate is a secondary
// action on the Community screen, so it is a neutral outline button; gold stays with the roles.

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
        { backgroundColor: palette.card, borderColor: palette.line },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.badgeContainer, { backgroundColor: palette.inverse }]}>
          <Text style={[styles.badgeText, { color: palette.onInverse }]}>
            {t('community.challenge.eyebrow')}
          </Text>
        </View>
        <View style={[styles.climateTag, { borderColor: palette.inkMuted }]}>
          <Text style={[styles.climateTagText, { color: palette.ink }]}>
            {climateLabel}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.title, { color: palette.ink }]}
        testID="community-challenge-title"
      >
        {challenge.title}
      </Text>
      <Text
        style={[styles.body, { color: palette.inkMuted }]}
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
        style={[
          styles.ctaButton,
          { backgroundColor: palette.page, borderColor: palette.lineStrong },
        ]}
        onPress={onParticipate}
      >
        <Text style={[styles.ctaButtonText, { color: palette.ink }]}>
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
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  climateTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    borderWidth: 1,
  },
  climateTagText: {
    fontSize: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  ctaButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  ctaButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
})
