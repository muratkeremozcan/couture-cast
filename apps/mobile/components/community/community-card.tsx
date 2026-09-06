import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityFeedItem } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

/**
 * `hero-theme.ts` carries no premium accent and no destructive token -- its
 * `danger` is the hero screen's `#B42318`/`#FF9A8F` pair, not the community
 * surface's merlot -- and this task may not extend that file, so both are derived
 * here in one place and reported as a palette gap.
 *
 * Merlot is used as a fill with white ink on top (10.2:1), never as text on a
 * dark ground, where it computes to 2.1:1 and fails.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'
const DESTRUCTIVE_MERLOT = '#7A1F2D'
const ON_DESTRUCTIVE = '#FFFFFF'

/**
 * A signed image URL that is already expired is refreshed by asking the screen to
 * refetch the feed, and a refetch produces new item objects. The first draft ran
 * that from an effect keyed on the whole `item`, so every refetch re-armed the
 * effect: an unbounded loop. The effect now keys on `item.id` and
 * `imageAccess.expiresAt` alone, the attempts are capped, and the card settles
 * into a visible "image unavailable" state with a manual retry once the budget is
 * spent. A URL that comes back valid resets the budget.
 */
const MAX_IMAGE_REFRESH_ATTEMPTS = 2
const IMAGE_REFRESH_BACKOFF_MS = [0, 4000]

interface CommunityCardMediaProps {
  postId: string
  imageUri: string
  label: string
  isUnavailable: boolean
  onError: () => void
  onRetry: () => void
}

function CommunityCardMedia({
  postId,
  imageUri,
  label,
  isUnavailable,
  onError,
  onRetry,
}: CommunityCardMediaProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View style={[styles.imageContainer, { backgroundColor: palette.skeleton }]}>
      {isUnavailable ? (
        <View
          style={styles.imageFallback}
          testID={`community-card-image-unavailable-${postId}`}
        >
          <Text style={[styles.imageFallbackText, { color: palette.text }]}>
            {t('community.card.imageUnavailable')}
          </Text>
          <TouchableOpacity
            testID={`community-card-image-retry-${postId}`}
            accessibilityRole="button"
            accessibilityLabel={t('community.card.imageRetry')}
            onPress={onRetry}
            style={[styles.secondaryButton, { borderColor: palette.mutedText }]}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
              {t('community.card.imageRetry')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Image
          testID={`community-card-image-${postId}`}
          source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="cover"
          // Without `accessible`, iOS VoiceOver skips the image entirely and the
          // alt text the author was made to confirm is never announced.
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          onError={onError}
        />
      )}
    </View>
  )
}

interface CommunityCardActionsProps {
  item: CommunityFeedItem
  isReported: boolean
  onReport: (item: CommunityFeedItem) => void | Promise<void>
  onWithdraw: (item: CommunityFeedItem) => void | Promise<void>
}

function CommunityCardActions({
  item,
  isReported,
  onReport,
  onWithdraw,
}: CommunityCardActionsProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  if (item.author.isSelf) {
    return (
      <TouchableOpacity
        testID={`community-card-withdraw-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('community.card.withdraw')}
        style={[styles.withdrawButton, { backgroundColor: DESTRUCTIVE_MERLOT }]}
        onPress={() => {
          void onWithdraw(item)
        }}
      >
        <Text style={[styles.withdrawButtonText, { color: ON_DESTRUCTIVE }]}>
          {t('community.card.withdraw')}
        </Text>
      </TouchableOpacity>
    )
  }

  // The label carries the reason the control is dead, so a screen reader hears
  // "Reported, dimmed" rather than an unexplained button.
  const label = isReported ? t('community.card.reported') : t('community.card.report')

  return (
    <TouchableOpacity
      testID={`community-card-report-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isReported }}
      disabled={isReported}
      style={[
        styles.secondaryButton,
        { borderColor: palette.mutedText },
        isReported && styles.secondaryButtonSettled,
      ]}
      onPress={() => {
        void onReport(item)
      }}
    >
      <Text
        style={[
          styles.secondaryButtonText,
          { color: isReported ? palette.mutedText : palette.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

export interface CommunityCardProps {
  item: CommunityFeedItem
  /** Settles the report control into its disabled "Reported" state. */
  isReported?: boolean
  /** Renders the sponsorship label variant required by the UX contract. */
  isSponsored?: boolean
  /** Lets the screen return accessibility focus here when a modal closes. */
  containerRef?: React.Ref<View>
  onReport: (item: CommunityFeedItem) => void | Promise<void>
  onWithdraw: (item: CommunityFeedItem) => void | Promise<void>
  onImageExpiry?: (item: CommunityFeedItem) => void | Promise<void>
}

export function CommunityCard({
  item,
  isReported = false,
  isSponsored = false,
  containerRef,
  onReport,
  onWithdraw,
  onImageExpiry,
}: CommunityCardProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  const itemId = item.id
  const expiresAt = item.imageAccess.expiresAt

  const [imageState, setImageState] = useState<'ok' | 'unavailable'>('ok')
  const [refreshTick, setRefreshTick] = useState(0)
  const attemptsRef = useRef(0)

  // Kept out of the expiry effect's dependency array on purpose: reading the
  // latest item and callback through a ref is what stops a refetch from
  // re-arming the timer with a brand new object identity.
  const latestRef = useRef({ item, onImageExpiry })
  useEffect(() => {
    latestRef.current = { item, onImageExpiry }
  })

  const requestImageRefresh = useCallback(() => {
    if (attemptsRef.current >= MAX_IMAGE_REFRESH_ATTEMPTS) {
      setImageState('unavailable')
      return
    }
    attemptsRef.current += 1
    setRefreshTick((tick) => tick + 1)
    void latestRef.current.onImageExpiry?.(latestRef.current.item)
  }, [])

  const handleRetryImage = useCallback(() => {
    attemptsRef.current = 0
    setImageState('ok')
    setRefreshTick((tick) => tick + 1)
  }, [])

  useEffect(() => {
    const expiresAtMs = Date.parse(expiresAt)
    if (Number.isNaN(expiresAtMs)) {
      setImageState('unavailable')
      return
    }

    const msUntilExpiry = expiresAtMs - Date.now()
    if (msUntilExpiry > 0) {
      // A usable URL arrived, so the bounded retry budget starts over.
      attemptsRef.current = 0
      setImageState('ok')
      const timer = setTimeout(requestImageRefresh, msUntilExpiry)
      return () => clearTimeout(timer)
    }

    if (attemptsRef.current >= MAX_IMAGE_REFRESH_ATTEMPTS) {
      setImageState('unavailable')
      return
    }

    const delay =
      IMAGE_REFRESH_BACKOFF_MS[attemptsRef.current] ??
      IMAGE_REFRESH_BACKOFF_MS[IMAGE_REFRESH_BACKOFF_MS.length - 1]
    const timer = setTimeout(requestImageRefresh, delay)
    return () => clearTimeout(timer)
  }, [expiresAt, itemId, refreshTick, requestImageRefresh])

  const authorName = item.author.isSelf
    ? t('community.card.authorSelf')
    : item.author.displayName.trim() || t('community.card.authorFallback')

  const climateLabel = item.climateBand
    ? t(`community.band.${item.climateBand}`)
    : t('community.band.unclassified')

  const cardLabel = isSponsored
    ? `${t('community.card.label', { author: authorName })}. ${t('community.card.sponsoredAnnounce')}`
    : t('community.card.label', { author: authorName })

  const imageLabel =
    item.altText?.trim() ||
    item.caption?.trim() ||
    t('community.card.label', { author: authorName })

  return (
    <View
      ref={containerRef}
      testID={`community-post-card-${item.id}`}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={cardLabel}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.divider },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.authorRow}>
          <View
            style={[styles.avatarPlaceholder, { backgroundColor: palette.subtleSurface }]}
          >
            <Text style={[styles.avatarText, { color: palette.text }]}>
              {authorName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.authorMeta}>
            <Text
              style={[styles.authorName, { color: palette.text }]}
              testID={`community-card-author-${item.id}`}
            >
              {authorName}
            </Text>
            {item.status !== 'published' && (
              <Text
                style={[styles.statusBadge, { color: palette.mutedText }]}
                testID={`community-card-status-${item.id}`}
              >
                {t(`community.status.${item.status}`)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.headerTags}>
          {isSponsored && (
            <View
              testID={`community-card-sponsored-${item.id}`}
              accessible
              accessibilityLabel={t('community.card.sponsoredAnnounce')}
              style={[styles.sponsoredPill, { backgroundColor: ACCENT_GOLD }]}
            >
              <Text style={[styles.sponsoredPillText, { color: ON_ACCENT }]}>
                {t('community.card.sponsored')}
              </Text>
            </View>
          )}
          <View
            style={[styles.climatePill, { borderColor: palette.mutedText }]}
            testID={`community-card-climate-pill-${item.id}`}
          >
            <Text style={[styles.climatePillText, { color: palette.text }]}>
              {climateLabel}
            </Text>
          </View>
        </View>
      </View>

      <CommunityCardMedia
        postId={item.id}
        imageUri={item.imageAccess.url}
        label={imageLabel}
        isUnavailable={imageState === 'unavailable'}
        onError={requestImageRefresh}
        onRetry={handleRetryImage}
      />

      {item.caption ? (
        <Text
          style={[styles.caption, { color: palette.text }]}
          testID={`community-card-caption-${item.id}`}
        >
          {item.caption}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <CommunityCardActions
          item={item}
          isReported={isReported}
          onReport={onReport}
          onWithdraw={onWithdraw}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  authorMeta: {
    flexShrink: 1,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '500',
  },
  headerTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sponsoredPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  sponsoredPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  climatePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  climatePillText: {
    fontSize: 11,
    fontWeight: '500',
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
  },
  imageFallbackText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  caption: {
    paddingHorizontal: 14,
    paddingTop: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonSettled: {
    borderStyle: 'dashed',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  withdrawButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  withdrawButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
})
