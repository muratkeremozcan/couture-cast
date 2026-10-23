// Story 6.7 owner: the compact Home teaser for the viewer's top City Spotlight entry.
import React, { forwardRef, useCallback, useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { SpotlightTeaserValue } from '@couture/api-client'
import type { HomeSpotlightTeaserLink } from '@/src/features/home/use-home-spotlight-teaser'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { IMAGE_LOAD_TIMEOUT_MS } from '@/components/community/community-card'

/** Same derived gold the community surfaces use for their accents. */
const ACCENT_GOLD = '#C9A14A'
const THUMBNAIL_SIZE = 72

export interface HomeSpotlightTeaserProps {
  value: SpotlightTeaserValue
  onOpen: () => void
  /** The image failed or never answered: the teaser leaves and reserves no space. */
  onImageError: () => void
  onFocus?: () => void
  onBlur?: () => void
}

/** The existing card rule: the viewer reads "You", a blank name the fallback. */
export function teaserAuthorName(
  value: SpotlightTeaserValue,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const { author } = value.item
  if (author.isSelf) return t('community.card.authorSelf')
  return author.displayName.trim() || t('community.card.authorFallback')
}

export const HomeSpotlightTeaser = forwardRef<View, HomeSpotlightTeaserProps>(
  function HomeSpotlightTeaser({ value, onOpen, onImageError, onFocus, onBlur }, ref) {
    const { t } = useTranslation()
    const palette = useHeroPalette()
    const { item, label } = value
    const imageUrl = item.imageAccess.url
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
    const count = item.reactions?.total ?? 0
    const author = teaserAuthorName(value, t)
    // Stable, so a Home re-render never restarts the image load.
    const handleLoad = useCallback(() => setLoadedUrl(imageUrl), [imageUrl])

    // A load that settles neither way counts as a failure: some Android stacks
    // fire no onError for a host that never answers.
    useEffect(() => {
      if (loadedUrl === imageUrl) return
      const timer = setTimeout(onImageError, IMAGE_LOAD_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }, [imageUrl, loadedUrl, onImageError])

    return (
      <View testID="home-spotlight-teaser" style={styles.section}>
        <Pressable
          ref={ref}
          testID="home-spotlight-teaser-link"
          accessibilityRole="link"
          accessibilityLabel={t('home.spotlightTeaser.linkLabel', {
            label,
            author,
            count,
          })}
          onPress={onOpen}
          onFocus={onFocus}
          onBlur={onBlur}
          style={({ pressed }) => [
            styles.link,
            {
              backgroundColor: palette.surface,
              borderColor: palette.divider,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View
            style={[styles.thumbnail, { backgroundColor: palette.skeleton }]}
            // Decorative: the link label already names the look.
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            aria-hidden
          >
            <Image
              testID="home-spotlight-teaser-image"
              source={{ uri: imageUrl }}
              style={styles.thumbnailImage}
              resizeMode="cover"
              accessible={false}
              alt=""
              onError={onImageError}
              onLoad={handleLoad}
            />
            {loadedUrl === imageUrl ? (
              // UI automation marker: only a completed load renders it.
              <View
                testID="home-spotlight-teaser-image-loaded"
                collapsable={false}
                pointerEvents="none"
                style={styles.loadedMarker}
              />
            ) : null}
          </View>
          <View style={styles.body}>
            <Text
              testID="home-spotlight-teaser-heading"
              numberOfLines={2}
              style={[styles.heading, { color: palette.text }]}
            >
              {t('home.spotlightTeaser.heading', { label })}
            </Text>
            <Text
              testID="home-spotlight-teaser-author"
              numberOfLines={1}
              style={[styles.meta, { color: palette.mutedText }]}
            >
              {author}
            </Text>
            <Text
              testID="home-spotlight-teaser-reactions"
              style={[styles.meta, { color: palette.mutedText }]}
            >
              {t('home.spotlightTeaser.reactions', { count })}
            </Text>
            <Text style={[styles.cta, { color: ACCENT_GOLD }]}>
              {t('home.spotlightTeaser.cta')}
            </Text>
          </View>
        </Pressable>
      </View>
    )
  }
)

/** Renders the teaser only for a valid value; anything else reserves no space. */
export function HomeSpotlightTeaserSlot({ teaser }: { teaser: HomeSpotlightTeaserLink }) {
  if (!teaser.value) return null
  return (
    <HomeSpotlightTeaser
      ref={teaser.linkRef}
      value={teaser.value}
      onOpen={teaser.open}
      onImageError={teaser.removeValue}
      onFocus={teaser.onFocus}
      onBlur={teaser.onBlur}
    />
  )
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  loadedMarker: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  body: {
    flex: 1,
    marginLeft: 12,
    gap: 2,
  },
  heading: {
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
  },
  cta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
  },
})
