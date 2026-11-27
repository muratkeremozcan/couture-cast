import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
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

export function useRecentHomePieces(owner: string | null, enabled: boolean) {
  const epoch = mobileIdentityEpoch()
  const [result, setResult] = useState<{
    epoch: number
    pieces: GarmentWithColor[] | null
  } | null>(null)
  useEffect(() => {
    if (!enabled) {
      setResult(null)
      return
    }
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
          token && current() ? listGarmentsFromMobile(token, request.signal) : null
        )
        .then((garments) => {
          if (!current()) return
          const pieces = garments
            ? [...garments]
                .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                .slice(0, 3)
            : null
          setResult({ epoch, pieces })
        })
        .catch(() => {
          if (current()) setResult({ epoch, pieces: null })
        })
    }
    read()
    const unsubscribe = onWardrobeChanged(read)
    return () => {
      controller?.abort()
      unsubscribe()
    }
  }, [enabled, epoch, owner])
  return enabled && result?.epoch === epoch ? result.pieces : undefined
}

export function HomeCloset({
  pieces,
}: {
  pieces: GarmentWithColor[] | null | undefined
}) {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  if (!pieces) return null
  const recentLabel = t('home.today.recentPieces')
  const garments = formatLocalizedList(
    pieces.map((piece) => formatGarmentAlt(i18n.language, piece)),
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
      <Text style={[styles.label, { color: palette.ink }]}>
        {populated ? recentLabel : t('home.today.addFirstPiece')}
      </Text>
      <View style={styles.previews} aria-hidden>
        {pieces.map((piece) =>
          piece.imageAccess ? (
            <Image
              key={piece.id}
              source={{ uri: piece.imageAccess.url }}
              style={[styles.thumbnail, { backgroundColor: palette.cardMuted }]}
            />
          ) : (
            <View
              key={piece.id}
              style={[styles.thumbnail, { backgroundColor: palette.cardMuted }]}
            >
              <Text style={{ color: palette.inkMuted }}>◇</Text>
            </View>
          )
        )}
        <Text style={{ color: palette.inkMuted }}>›</Text>
      </View>
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
  label: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  previews: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thumbnail: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
