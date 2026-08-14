import React, { type ComponentRef, useRef, useState } from 'react'
import { StyleSheet, Platform, Pressable } from 'react-native'
import { Text, View } from '@/components/themed'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'
import {
  mintAffiliateClickFromMobile,
  openAffiliatePartnerSite,
  resolveRenderableShopThisLook,
} from '@/src/lib/commerce'
import { GarmentItemTile } from './garment-item-tile'
import { useHeroPalette } from './hero-theme'
import { useTranslation } from 'react-i18next'

type OutfitRecommendationCardProps = {
  outfit?: ScenarioOutfit
  onSwapGarment: (garmentId: string, trigger?: number | { focus?: () => void }) => void
  onGarmentRef?: (
    garmentId: string,
    element: ComponentRef<typeof Pressable> | null
  ) => void
  isLoading?: boolean
  /**
   * True when `outfit` came out of the device ritual cache instead of the
   * network. A cache-served payload never renders an affiliate CTA, because the
   * cache outlives an opt-out (fifteen minutes online, indefinitely offline).
   */
  isCacheServed?: boolean
}

export function OutfitRecommendationCard({
  outfit,
  onSwapGarment,
  onGarmentRef,
  isLoading,
  isCacheServed = false,
}: OutfitRecommendationCardProps) {
  const [selectedBadgeKey, setSelectedBadgeKey] = useState<string | null>(null)
  // Stamped with the recommendation it belongs to. This component instance
  // survives a scenario toggle, so an unstamped busy or error state would follow
  // the user onto a different card and describe an offer they never touched.
  const [ctaActivation, setCtaActivation] = useState<{
    outfitId: string
    status: 'pending' | 'error'
  } | null>(null)
  // State alone cannot block a double tap: two presses inside one React batch
  // both read the pre-update value and both mint a click. The ref settles
  // synchronously, so the second press is dropped before it reaches the network.
  const ctaActivationInFlight = useRef(false)
  const { t } = useTranslation()
  const palette = useHeroPalette()

  if (isLoading) {
    return (
      <View style={styles.skeletonContainer} testID="outfit-recommendation-card-skeleton">
        <View style={[styles.skeletonNotes, { backgroundColor: palette.skeleton }]} />
        <View style={styles.skeletonBadgeRow}>
          <View style={[styles.skeletonBadge, { backgroundColor: palette.skeleton }]} />
          <View style={[styles.skeletonBadge, { backgroundColor: palette.skeleton }]} />
        </View>
        <View style={[styles.skeletonTile, { backgroundColor: palette.skeleton }]} />
        <View style={[styles.skeletonTile, { backgroundColor: palette.skeleton }]} />
      </View>
    )
  }

  if (!outfit) {
    return null
  }

  const handleBadgePress = (key: string) => {
    setSelectedBadgeKey(selectedBadgeKey === key ? null : key)
  }

  const activeBadgeInfo = outfit.reasoningBadges?.find((b) => b.key === selectedBadgeKey)

  const shopThisLook = resolveRenderableShopThisLook(outfit, isCacheServed)
  const activationForThisCard =
    ctaActivation?.outfitId === outfit.id ? ctaActivation.status : null
  const isActivatingCta = activationForThisCard === 'pending'
  const ctaError =
    activationForThisCard === 'error' ? t('commerce.shopThisLook.error') : null
  const ctaLabel = isActivatingCta
    ? t('commerce.shopThisLook.loading')
    : t('commerce.shopThisLook.cta')
  const partnerLabel = shopThisLook
    ? t('commerce.shopThisLook.partnerLabel', {
        partner: shopThisLook.partnerDisplayName,
      })
    : ''
  const opensInBrowserLabel = t('commerce.shopThisLook.opensInBrowser')

  const handleShopThisLookPress = async () => {
    if (!shopThisLook || ctaActivationInFlight.current) {
      return
    }

    ctaActivationInFlight.current = true
    setCtaActivation({ outfitId: outfit.id, status: 'pending' })

    try {
      const redirectUrl = await mintAffiliateClickFromMobile({
        offerId: shopThisLook.offerId,
        recommendationId: outfit.id,
        surface: 'mobile_hero',
      })
      // Only navigate once the click is attributed. Traffic the partner cannot
      // attribute is worth nothing to them and cannot be audited by us, so a
      // failed mint stops here. A handoff that fails after a successful mint
      // surfaces the same message: the click row and its event stand, and no
      // compensating event is emitted.
      await openAffiliatePartnerSite(redirectUrl)
      setCtaActivation(null)
    } catch {
      setCtaActivation({ outfitId: outfit.id, status: 'error' })
    } finally {
      ctaActivationInFlight.current = false
    }
  }

  return (
    <View style={styles.container} testID="outfit-recommendation-card">
      {/* Comfort Notes */}
      <View
        style={[
          styles.notesContainer,
          { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
        ]}
      >
        <Text
          style={[styles.comfortNotes, { color: palette.text }]}
          testID="outfit-comfort-notes"
        >
          {outfit.comfortNotes}
        </Text>
      </View>

      {/* Reasoning Badges */}
      {outfit.reasoningBadges && outfit.reasoningBadges.length > 0 && (
        <View style={styles.badgesSection}>
          <View style={styles.badgeRow}>
            {outfit.reasoningBadges.map((badge) => {
              const isSelected = selectedBadgeKey === badge.key
              return (
                <Pressable
                  key={badge.key}
                  onPress={() => handleBadgePress(badge.key)}
                  style={[
                    styles.badge,
                    { backgroundColor: palette.surface, borderColor: palette.divider },
                    isSelected && styles.badgeSelected,
                  ]}
                  testID={`reasoning-badge-${badge.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.badgeLabel,
                      { color: palette.text },
                      isSelected && styles.badgeLabelSelected,
                    ]}
                  >
                    {badge.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {/* Expanded Badge Details */}
          {activeBadgeInfo && (
            <View
              style={[
                styles.badgeDetails,
                { backgroundColor: palette.surface, borderColor: palette.divider },
              ]}
              testID="badge-details-panel"
            >
              <Text style={styles.detailsTitle}>
                {t('hero.badge_justification', {
                  label: activeBadgeInfo.label,
                  defaultValue: `${activeBadgeInfo.label} justification:`,
                })}
              </Text>
              {activeBadgeInfo.bullets.map((bullet, idx) => (
                <Text key={idx} style={[styles.bulletText, { color: palette.text }]}>
                  • {bullet}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Garments List */}
      <View style={styles.garmentsList}>
        {outfit.garmentIds.map((garmentId) => (
          <GarmentItemTile
            key={garmentId}
            garmentId={garmentId}
            onSwap={onSwapGarment}
            onRef={onGarmentRef}
          />
        ))}
      </View>

      {/* Affiliate "Shop this look" block. Reading order is the requirement,
          not a layout preference: PRD FR5.1 accepts only a disclosure that is
          visible before the click, so it is a plain sibling text node ahead of
          the control, never a post-tap interstitial, a tooltip, or an
          accessibility label. */}
      {shopThisLook && (
        <View
          style={[
            styles.shopThisLook,
            { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
          ]}
          testID="shop-this-look-block"
        >
          <Text
            style={[styles.shopThisLookDisclosure, { color: palette.text }]}
            testID="shop-this-look-disclosure"
          >
            {t('commerce.shopThisLook.disclosure')}
          </Text>
          <Text
            style={[styles.shopThisLookPartner, { color: palette.mutedText }]}
            testID="shop-this-look-partner"
          >
            {partnerLabel}
          </Text>
          <Text
            style={[styles.shopThisLookOfferTitle, { color: palette.text }]}
            testID="shop-this-look-offer-title"
          >
            {shopThisLook.offerTitle}
          </Text>
          <Pressable
            style={[styles.shopThisLookCta, { backgroundColor: palette.text }]}
            onPress={() => {
              void handleShopThisLookPress()
            }}
            testID="shop-this-look-cta"
            accessibilityRole="button"
            // Composed in the order decision 16 fixes: control label, partner,
            // then the handoff warning. The visible label leads so the
            // accessible name always contains what a speech-input user reads.
            accessibilityLabel={[ctaLabel, partnerLabel, opensInBrowserLabel].join('. ')}
            // Busy rather than disabled: the control is working, not
            // unavailable. `aria-busy` rides alongside because react-native-web
            // does not project `accessibilityState` onto the DOM, the same pair
            // `components/chip-navigation.tsx` ships.
            accessibilityState={{ busy: isActivatingCta }}
            aria-busy={isActivatingCta}
          >
            <Text style={[styles.shopThisLookCtaLabel, { color: palette.background }]}>
              {ctaLabel}
            </Text>
          </Pressable>
          <Text
            style={[styles.shopThisLookOpensInBrowser, { color: palette.mutedText }]}
            testID="shop-this-look-opens-in-browser"
          >
            {opensInBrowserLabel}
          </Text>
          {ctaError ? (
            <Text
              style={[styles.shopThisLookError, { color: palette.danger }]}
              testID="shop-this-look-error"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {ctaError}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  notesContainer: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6E6ED',
    padding: 14,
    marginBottom: 16,
  },
  comfortNotes: {
    fontSize: 14,
    lineHeight: 20,
    color: '#111111',
    fontStyle: 'italic',
    fontFamily: Platform.select({
      ios: 'Playfair Display',
      android: 'Playfair Display',
      web: 'Playfair Display, serif',
      default: 'System',
    }),
  },
  badgesSection: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  badge: {
    borderWidth: 1,
    borderColor: '#E6E6ED',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  badgeSelected: {
    backgroundColor: '#C9A14A', // gold color
    borderColor: '#C9A14A',
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111111',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
  },
  badgeLabelSelected: {
    color: '#111111',
  },
  badgeDetails: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6E6ED',
    borderRadius: 8,
    padding: 12,
    gap: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
      web: {
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
      },
    }),
  },
  detailsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A691F',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  bulletText: {
    fontSize: 13,
    color: '#111111',
    lineHeight: 18,
  },
  garmentsList: {
    backgroundColor: 'transparent',
    gap: 8,
  },
  shopThisLook: {
    marginTop: 16,
    padding: 14,
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
  },
  shopThisLookDisclosure: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  shopThisLookPartner: {
    fontSize: 12,
    lineHeight: 16,
  },
  shopThisLookOfferTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  shopThisLookCta: {
    // Decision 17: at least 44 by 44 device-independent pixels, so the control
    // stays operable by touch and by switch input.
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopThisLookCtaLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  shopThisLookOpensInBrowser: {
    fontSize: 12,
    lineHeight: 16,
  },
  shopThisLookError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    gap: 12,
  },
  skeletonNotes: {
    height: 60,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
  },
  skeletonBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
  },
  skeletonBadge: {
    width: 80,
    height: 28,
    backgroundColor: '#E6E6ED',
    borderRadius: 14,
  },
  skeletonTile: {
    height: 60,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
  },
})
