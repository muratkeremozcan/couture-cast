// Story 6.11 owner: a banned member's notice on mobile in `apps/mobile/src/features/community/community-banned-notice.tsx`.
// It names the term and the appeal state from the 403 body, and never a reason, moderator or case.
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityBannedError } from '@couture/api-client/contracts/http'

export function CommunityBannedNotice({
  sanction,
  locale,
  textColor,
  mutedColor,
}: {
  sanction: CommunityBannedError['sanction']
  locale: string
  textColor: string
  mutedColor: string
}) {
  const { t } = useTranslation()
  const term =
    sanction.kind === 'temporary'
      ? t('community.banned.temporary', {
          until: new Intl.DateTimeFormat(locale, {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(new Date(sanction.expiresAt)),
        })
      : t('community.banned.permanent')
  const body = [styles.body, { color: mutedColor }]
  return (
    <View style={styles.container} testID="community-banned-notice">
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={[styles.title, { color: textColor }]}
      >
        {t('community.banned.title')}
      </Text>
      <Text style={body}>{term}</Text>
      <Text style={body}>{t('community.banned.scope')}</Text>
      <Text style={body}>{t(`community.banned.appeal.${sanction.appealStatus}`)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
})
