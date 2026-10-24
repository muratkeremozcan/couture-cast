// Story 6.7 owner: the compact Home teaser for the viewer's top City Spotlight entry.
import React, {
  type RefObject,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { Image, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { SpotlightTeaserValue } from '@couture/api-client'
import {
  type TeaserFocusMove,
  useHomeSpotlightTeaserLink,
} from '@/src/features/home/use-home-spotlight-teaser'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { IMAGE_LOAD_TIMEOUT_MS } from '@/components/community/community-card'
import {
  CommunitySponsoredShop,
  withDisclosure,
} from '@/components/community/community-sponsored-shop'
import { resolveRenderableCommunitySponsorship } from '@/src/lib/commerce'
import { SponsoredCtaImpressions } from '@/src/features/community/sponsored-cta-impressions'
import { useSponsoredCtaShown } from '@/src/features/community/sponsored-cta-shown'

/**
 * The CTA is text, so it needs AA contrast: the deep gold the web hero uses on
 * light surfaces (#C9A14A on white is about 2.3:1), the accent gold on dark ones.
 */
const CTA_GOLD = { light: '#8A691F', dark: '#C9A14A' } as const
const THUMBNAIL_SIZE = 72
/** The community card's Partnered pill colours, so both read as one disclosure. */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'

export interface HomeSpotlightTeaserProps {
  value: SpotlightTeaserValue
  onOpen: () => void
  /** The image failed or never answered: the teaser leaves and reserves no space. */
  onImageError: () => void
  /**
   * Home is focused and in the foreground. The image deadline runs only then:
   * an app in the background loads nothing and reports nothing, so time spent
   * there would fail an image that never had its chance.
   */
  active: boolean
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
  function HomeSpotlightTeaser(
    { value, onOpen, onImageError, active, onFocus, onBlur },
    ref
  ) {
    const { t } = useTranslation()
    const palette = useHeroPalette()
    const ctaColor = CTA_GOLD[useColorScheme() === 'dark' ? 'dark' : 'light']
    const { item, label } = value
    const imageUrl = item.imageAccess.url
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
    const count = item.reactions?.total ?? 0
    const author = teaserAuthorName(value, t)
    // Stable, so a Home re-render never restarts the image load.
    const handleLoad = useCallback(() => setLoadedUrl(imageUrl), [imageUrl])
    // Story 6.7b: the teaser value is only ever a live read held in memory for
    // five minutes, so a block on it is renderable as served.
    const sponsorship = resolveRenderableCommunitySponsorship(item)
    useSponsoredCtaShown('home_teaser', item.id, sponsorship)
    const sponsoredAnnounce = sponsorship
      ? t('community.card.sponsoredAnnounce', { partner: sponsorship.partnerDisplayName })
      : null
    const linkLabel = t('home.spotlightTeaser.linkLabel', { label, author, count })

    // A load that settles neither way counts as a failure: some Android stacks
    // fire no onError for a host that never answers.
    useEffect(() => {
      if (!active || loadedUrl === imageUrl) return
      const timer = setTimeout(onImageError, IMAGE_LOAD_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }, [active, imageUrl, loadedUrl, onImageError])

    return (
      <View testID="home-spotlight-teaser" style={styles.section}>
        {/* The card chrome wraps the link and the sponsored row, so the
            disclosure and CTA read as part of the teaser while staying
            outside the link's touch target. */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.divider },
          ]}
        >
          <Pressable
            ref={ref}
            testID="home-spotlight-teaser-link"
            accessibilityRole="link"
            accessibilityLabel={
              sponsoredAnnounce ? withDisclosure(linkLabel, sponsoredAnnounce) : linkLabel
            }
            onPress={onOpen}
            onFocus={onFocus}
            onBlur={onBlur}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.85 : 1 }]}
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
              <Text style={[styles.cta, { color: ctaColor }]}>
                {t('home.spotlightTeaser.cta')}
              </Text>
            </View>
          </Pressable>
          {sponsorship && sponsoredAnnounce ? (
            // Siblings of the link: the disclosure stays visible to automation on
            // iOS, and the CTA is its own focus stop.
            <View testID="home-spotlight-teaser-sponsored" style={styles.sponsored}>
              <View
                testID="home-spotlight-teaser-partnered"
                accessible
                accessibilityLabel={sponsoredAnnounce}
                style={[styles.partneredPill, { backgroundColor: ACCENT_GOLD }]}
              >
                <Text style={[styles.partneredText, { color: ON_ACCENT }]}>
                  {t('community.card.sponsored')}
                </Text>
              </View>
              <CommunitySponsoredShop
                postId={item.id}
                sponsorship={sponsorship}
                surface="home_teaser"
                testID="home-spotlight-teaser-shop"
                errorTestID="home-spotlight-teaser-shop-error"
                style={styles.shop}
              />
            </View>
          ) : null}
        </View>
        {loadedUrl === imageUrl ? (
          // UI automation marker: only a completed load renders it. A sibling of
          // the link, because iOS hides an accessible element's descendants.
          <View
            testID="home-spotlight-teaser-image-loaded"
            collapsable={false}
            pointerEvents="none"
            style={styles.loadedMarker}
          />
        ) : null}
      </View>
    )
  }
)

/**
 * Owns the teaser's lifecycle, so a teaser change re-renders this subtree and
 * never the hero above it. Renders the teaser only for a valid value; anything
 * else reserves no space.
 */
export const HomeSpotlightTeaserSlot = memo(function HomeSpotlightTeaserSlot({
  applicationUserId,
  scrollViewRef,
}: {
  applicationUserId: string | null
  scrollViewRef: RefObject<unknown>
}) {
  const teaser = useHomeSpotlightTeaserLink({ applicationUserId, scrollViewRef })
  const { focusRequested, focusLanded } = teaser
  return (
    <SponsoredCtaImpressions focused={teaser.active}>
      {teaser.value ? (
        <HomeSpotlightTeaser
          ref={teaser.linkRef}
          value={teaser.value}
          onOpen={teaser.open}
          onImageError={teaser.removeValue}
          active={teaser.active}
          onFocus={teaser.onFocus}
          onBlur={teaser.onBlur}
        />
      ) : null}
      {focusRequested ? (
        <FocusMarker kind="focus-requested" move={focusRequested} />
      ) : null}
      {focusLanded ? <FocusMarker kind="focused" move={focusLanded} /> : null}
    </SponsoredCtaImpressions>
  )
})

/**
 * UI automation marker: names the target and count of the last focus move Home
 * requested (`focus-requested`) or the platform confirmed (`focused`). It has no
 * label and takes no touches.
 */
function FocusMarker({
  kind,
  move,
}: {
  kind: 'focus-requested' | 'focused'
  move: TeaserFocusMove
}) {
  return (
    <View
      testID={`home-spotlight-teaser-${kind}-${move.target}-${move.count}`}
      collapsable={false}
      pointerEvents="none"
      style={styles.focusMarker}
    />
  )
}

const styles = StyleSheet.create({
  // Out of flow, so a fallback move leaves Home with no reserved space. It sits
  // at the end of the scroll content, where the teaser would be.
  focusMarker: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
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
  sponsored: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
    alignItems: 'flex-start',
  },
  partneredPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  partneredText: {
    fontSize: 11,
    fontWeight: '700',
  },
  shop: {
    alignSelf: 'stretch',
  },
  loadedMarker: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
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
