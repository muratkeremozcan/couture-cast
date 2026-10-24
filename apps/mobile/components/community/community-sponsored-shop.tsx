// Story 6.7b owner: the "Shop this look" control on a sponsored community card
// and on the Home teaser.
//
// It is always its own focus stop, rendered as a sibling of the card's or
// teaser's open action, so activating one can never trigger the other.
// The flow mirrors the hero CTA (`outfit-recommendation-card.tsx`): mint the
// attributed click first, open the partner site in the in-app browser only once
// the click exists, and keep focus on the button through the loading and error
// states so a retry is one more activation.
import React, { forwardRef, useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  AffiliateCommunitySurface,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  mintAffiliateClickFromMobile,
  openAffiliatePartnerSite,
} from '@/src/lib/commerce'

/**
 * Appends the Partnered disclosure to an accessible name as its own sentence.
 * A label that already ends a sentence (the teaser link's does, in every
 * locale) gets a space, so no reader hears a doubled stop.
 */
export function withDisclosure(label: string, disclosure: string): string {
  const trimmed = label.trimEnd()
  return /[.!?\u3002]$/.test(trimmed)
    ? `${trimmed} ${disclosure}`
    : `${trimmed}. ${disclosure}`
}

export interface CommunitySponsoredShopProps {
  postId: string
  sponsorship: CommunitySponsorship
  surface: AffiliateCommunitySurface
  testID: string
  errorTestID: string
  /** The visible "opens in an in-app browser" line under the button. */
  opensTestID: string
  style?: StyleProp<ViewStyle>
  /** Story 6.7b: lets a host track input focus on the button (Home's recovery). */
  onFocus?: () => void
  onBlur?: () => void
}

type Activation = { key: string; status: 'pending' | 'error' }

export const CommunitySponsoredShop = forwardRef<View, CommunitySponsoredShopProps>(
  function CommunitySponsoredShop(
    {
      postId,
      sponsorship,
      surface,
      testID,
      errorTestID,
      opensTestID,
      style,
      onFocus,
      onBlur,
    },
    ref
  ) {
    const { t } = useTranslation()
    const palette = useHeroPalette()
    // Stamped with the post and offer it belongs to, so a recycled list cell or a
    // changed offer never inherits another block's busy or error state.
    const blockKey = `${postId}\u0000${sponsorship.offerId}`
    const [activation, setActivation] = useState<Activation | null>(null)
    // State cannot stop two presses inside one React batch; the ref settles at once.
    const inFlight = useRef(false)
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])

    const status = activation?.key === blockKey ? activation.status : null
    const isPending = status === 'pending'
    const ctaLabel = isPending
      ? t('commerce.shopThisLook.loading')
      : t('community.card.shopCta', { partner: sponsorship.partnerDisplayName })
    const opensInBrowser = t('commerce.shopThisLook.opensInBrowser')

    const handlePress = async () => {
      if (inFlight.current) return
      inFlight.current = true
      setActivation({ key: blockKey, status: 'pending' })
      // Announced here, once per activation. The button keeps focus, so a
      // label change alone would go unspoken on most screen readers.
      AccessibilityInfo.announceForAccessibility(t('commerce.shopThisLook.loading'))
      try {
        const redirectUrl = await mintAffiliateClickFromMobile({
          offerId: sponsorship.offerId,
          recommendationId: postId,
          surface,
        })
        // A failed mint never navigates: unattributed traffic cannot be audited.
        await openAffiliatePartnerSite(redirectUrl)
        if (mounted.current) setActivation(null)
      } catch {
        // A 404 (the link ended after the read), a 5xx, a network failure and a
        // failed handoff all read the same, and retrying is the same activation.
        if (mounted.current) {
          setActivation({ key: blockKey, status: 'error' })
          AccessibilityInfo.announceForAccessibility(t('commerce.shopThisLook.error'))
        }
      } finally {
        inFlight.current = false
      }
    }

    return (
      <View style={[styles.container, style]}>
        <Pressable
          ref={ref}
          testID={testID}
          accessibilityRole="button"
          // The visible label leads, so a speech-input user can say what they read;
          // it names the action and the partner, then that it leaves the app. That
          // last part sits in the name, which every screen reader speaks; a hint
          // goes unspoken when a reader has hints switched off.
          accessibilityLabel={`${ctaLabel}. ${opensInBrowser}`}
          onFocus={onFocus}
          onBlur={onBlur}
          // Busy state keeps the control enabled: a disabled control can drop
          // accessibility focus.
          accessibilityState={{ busy: isPending }}
          aria-busy={isPending}
          onPress={() => {
            void handlePress()
          }}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: palette.text, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: palette.background }]}>
            {ctaLabel}
          </Text>
        </Pressable>
        <Text
          testID={opensTestID}
          // Already in the button's name, so it is not announced a second time.
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          style={[styles.opens, { color: palette.mutedText }]}
        >
          {opensInBrowser}
        </Text>
        {status === 'error' ? (
          // Announced once by the handler above; a live region here would speak
          // it a second time on Android.
          <Text testID={errorTestID} style={[styles.error, { color: palette.danger }]}>
            {t('commerce.shopThisLook.error')}
          </Text>
        ) : null}
      </View>
    )
  }
)

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  button: {
    // At least 44 by 44 points, the same floor as the hero CTA.
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  opens: {
    fontSize: 12,
    lineHeight: 16,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
})
