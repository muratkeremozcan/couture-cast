// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 U-EVENTS-SCHEMA and U-PRIVACY-ALLOWLIST: guest preview analytics carry
// closed enums only, never a URL, and the preview is never recorded as a page view.
import { describe, expect, it } from 'vitest'
import {
  GUEST_PREVIEW_INTERACTED_EVENT,
  GUEST_PREVIEW_SIGNUP_CLICKED_EVENT,
  GUEST_PREVIEW_STARTED_EVENT,
  analyticsEventNameSchema,
  analyticsEventSchemas,
  guestPreviewActionSchema,
  guestPreviewControlSchema,
  mobileAnalyticsPrivacyFilter,
  templateAnalyticsRoute,
  trackGuestPreviewInteracted,
  trackGuestPreviewSignupClicked,
  trackGuestPreviewStarted,
  webAnalyticsPrivacyFilter,
} from '../src'
import { analyticsPropertySchemas } from '../src/testing/analytics-event-assertions'

const base = { platform: 'web', catalog_version: '2026-11-15.1' } as const
const event = (name: string, properties: Record<string, unknown>) => ({
  event: name,
  uuid: '0192d3a4-5b6c-7d8e-9f01-23456789abcd',
  properties,
})

describe('guest preview event registry', () => {
  it('registers the three client events and their schemas', () => {
    for (const name of [
      GUEST_PREVIEW_STARTED_EVENT,
      GUEST_PREVIEW_INTERACTED_EVENT,
      GUEST_PREVIEW_SIGNUP_CLICKED_EVENT,
    ]) {
      expect(analyticsEventNameSchema.safeParse(name).success).toBe(true)
      expect(analyticsEventSchemas).toHaveProperty(name)
      expect(analyticsPropertySchemas).toHaveProperty(name)
    }
  })

  it('pins the closed action and control enums', () => {
    expect(guestPreviewActionSchema.options).toEqual([
      'control_changed',
      'look_changed',
      'garment_swapped',
      'swaps_undone',
      'look_voted',
      'votes_reset',
      'wardrobe_opened',
      'item_inspected',
      'preview_reset',
      'preview_exited',
    ])
    expect(guestPreviewControlSchema.options).toEqual([
      'weather',
      'thermal',
      'wind',
      'rain',
      'collection',
      'category',
    ])
  })

  it('accepts the documented shapes exactly', () => {
    expect(trackGuestPreviewStarted(base)).toEqual(base)
    expect(
      trackGuestPreviewInteracted({ ...base, action: 'control_changed', control: 'wind' })
    ).toEqual({
      ...base,
      action: 'control_changed',
      control: 'wind',
    })
    expect(trackGuestPreviewInteracted({ ...base, action: 'look_voted' })).toEqual({
      ...base,
      action: 'look_voted',
    })
    expect(trackGuestPreviewSignupClicked({ ...base, action: 'sign_in' })).toEqual({
      ...base,
      action: 'sign_in',
    })
  })

  it.each([
    ['birthdate', '2000-01-01'],
    ['age_band', '13-15'],
    ['look_id', 'sample:l:city-wool'],
    ['vote', 'like'],
    ['value', 'cold'],
    ['url', '/preview'],
  ])('refuses an extra %s key', (key, value) => {
    expect(() => trackGuestPreviewStarted({ ...base, [key]: value } as never)).toThrow()
  })

  it('requires control for control_changed and only for it', () => {
    expect(() =>
      trackGuestPreviewInteracted({ ...base, action: 'control_changed' })
    ).toThrow()
    expect(() =>
      trackGuestPreviewInteracted({ ...base, action: 'look_changed', control: 'weather' })
    ).toThrow()
  })

  it('refuses an unknown platform or catalog version format', () => {
    expect(() =>
      trackGuestPreviewStarted({ ...base, platform: 'desktop' } as never)
    ).toThrow()
    expect(() =>
      trackGuestPreviewStarted({ ...base, catalog_version: 'latest' })
    ).toThrow()
  })
})

describe('guest preview privacy boundary', () => {
  it('keeps only the allowlisted keys and the privacy switches, with no URL', () => {
    const filtered = webAnalyticsPrivacyFilter(
      event(GUEST_PREVIEW_INTERACTED_EVENT, {
        ...base,
        action: 'control_changed',
        control: 'thermal',
        locale: 'tr-TR',
        value: 'cold',
        look_id: 'sample:l:city-wool',
        $current_url: 'https://couturecast.app/preview?view=preferences',
        $pathname: '/preview',
        $host: 'couturecast.app',
        $referrer: 'https://couturecast.app/',
        $referring_domain: 'couturecast.app',
        $prev_pageview_pathname: '/',
        $lib: 'web',
      })
    )
    expect(filtered?.properties).toEqual({
      ...base,
      action: 'control_changed',
      control: 'thermal',
      locale: 'tr-TR',
      $lib: 'web',
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
    })
  })

  it('drops out-of-enum values', () => {
    const filtered = mobileAnalyticsPrivacyFilter(
      event(GUEST_PREVIEW_SIGNUP_CLICKED_EVENT, {
        platform: 'android',
        catalog_version: '../etc',
        action: 'signup_completed',
      })
    )
    expect(filtered?.properties).toEqual({
      platform: 'android',
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
    })
  })

  it.each([
    ['$pageview', { $current_url: 'https://couturecast.app/preview' }],
    ['$pageview', { $pathname: '/preview/continue' }],
    ['$pageleave', { $current_url: 'http://localhost:3000/preview?view=wardrobe' }],
    ['$pageview', { $current_url: 'https://couturecast.app/preview#gate' }],
  ])('drops a web %s on a preview path', (name, properties) => {
    expect(webAnalyticsPrivacyFilter(event(name, properties))).toBeNull()
  })

  it.each(['/preview', '/preview-continue'])(
    'drops a mobile $screen for %s',
    (screen) => {
      expect(
        mobileAnalyticsPrivacyFilter(
          event('$screen', { $screen_name: screen, previous_screen: null })
        )
      ).toBeNull()
    }
  )

  it('keeps page and screen views elsewhere, including look-alike paths', () => {
    for (const path of ['/', '/previewer', '/settings']) {
      expect(
        webAnalyticsPrivacyFilter(event('$pageview', { $pathname: path }))
      ).not.toBeNull()
    }
    expect(
      mobileAnalyticsPrivacyFilter(
        event('$screen', { $screen_name: '/settings', previous_screen: null })
      )
    ).not.toBeNull()
  })

  it('keeps the first view after the preview without naming the preview', () => {
    const web = webAnalyticsPrivacyFilter(
      event('$pageview', {
        $pathname: '/signup',
        $prev_pageview_pathname: '/preview/continue',
        $prev_pageview_duration: 12,
        $prev_pageview_max_scroll: 0,
      })
    ) as { properties: Record<string, unknown> } | null
    expect(web?.properties.$pathname).toBe('/signup')
    expect(
      Object.keys(web?.properties ?? {}).filter((key) =>
        key.startsWith('$prev_pageview_')
      )
    ).toEqual([])
    const mobile = mobileAnalyticsPrivacyFilter(
      event('$screen', { $screen_name: '/signup', previous_screen: '/preview' })
    ) as { properties: Record<string, unknown> } | null
    expect(mobile?.properties.$screen_name).toBe('/signup')
    expect(mobile?.properties).not.toHaveProperty('previous_screen')
    // Any other previous view keeps its keys.
    const other = webAnalyticsPrivacyFilter(
      event('$pageview', {
        $pathname: '/signup',
        $prev_pageview_pathname: '/',
        $prev_pageview_duration: 12,
      })
    ) as { properties: Record<string, unknown> } | null
    expect(other?.properties).toMatchObject({
      $prev_pageview_pathname: '/',
      $prev_pageview_duration: 12,
    })
  })

  it('knows the preview routes so a non-view event templates them', () => {
    expect(templateAnalyticsRoute('/preview?view=wardrobe', 'web')).toBe('/preview')
    expect(templateAnalyticsRoute('/preview/continue', 'web')).toBe('/preview/continue')
    expect(templateAnalyticsRoute('/preview-continue', 'mobile')).toBe(
      '/preview-continue'
    )
  })
})
