import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { GarmentCategory, GarmentWithTags } from '@couture/api-client/contracts/http'
import { formatGarmentAlt, formatLocalizedList } from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { TAB_BODY_INSET } from '@/src/theme/tokens'

export function useHomeWardrobe(owner: string | null, enabled: boolean) {
  const epoch = mobileIdentityEpoch()
  const [result, setResult] = useState<{
    epoch: number
    pieces: (GarmentCategory | null)[] | null
    wardrobe: GarmentWithTags[]
  } | null>(null)
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return
      let controller: AbortController | undefined
      const read = () => {
        controller?.abort()
        const request = new AbortController()
        controller = request
        const current = () =>
          !request.signal.aborted &&
          mobileApplicationUserId() === owner &&
          mobileIdentityEpoch() === epoch
        void resolveMobileAccessToken()
          .then((token) =>
            token && current()
              ? listGarmentsFromMobile(token, request.signal, { today: true })
              : null
          )
          .then((garments) => {
            if (!current()) return
            const pieces = garments
              ? [...garments]
                  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                  .slice(0, 3)
                  .map(({ category }) => category)
              : null
            setResult({ epoch, pieces, wardrobe: garments ?? [] })
          })
          .catch(() => {
            if (current()) setResult({ epoch, pieces: null, wardrobe: [] })
          })
      }
      read()
      const unsubscribe = onWardrobeChanged(() => {
        setResult((current) =>
          current?.epoch === epoch ? { epoch, pieces: null, wardrobe: [] } : current
        )
        read()
      })
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') read()
        else controller?.abort()
      })
      return () => {
        controller?.abort()
        unsubscribe()
        appState.remove()
      }
    }, [enabled, epoch, owner])
  )
  return enabled && result?.epoch === epoch ? result : undefined
}

export function HomeCloset({
  pieces,
}: {
  pieces: (GarmentCategory | null)[] | null | undefined
}) {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  if (!pieces) return null
  const recentLabel = t('home.today.recentPieces')
  const garments = formatLocalizedList(
    pieces.map((category) => formatGarmentAlt(i18n.language, { category })),
    i18n.language
  )
  const populated = pieces.length > 0
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={
        populated ? `${recentLabel}. ${garments}` : t('home.today.addFirstPiece')
      }
      onPress={() => router.navigate(populated ? '/wardrobe' : '/wardrobe?entry=add')}
      testID={populated ? 'home-closet-strip' : 'home-add-garment'}
      style={[styles.row, { borderBottomColor: palette.line }]}
    >
      <View style={styles.labelGroup}>
        <Text style={[styles.label, { color: palette.ink }]}>
          {populated ? recentLabel : t('home.today.addFirstPiece')}
        </Text>
        {populated && <Text style={{ color: palette.inkMuted }}>{garments}</Text>}
      </View>
      <Text aria-hidden style={{ color: palette.inkMuted }}>
        ›
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    marginHorizontal: TAB_BODY_INSET,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  labelGroup: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: '600' },
})
