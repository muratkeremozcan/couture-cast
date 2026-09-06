// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the community lookbook card.
//
// The card is 480 lines that were previously exercised only through the screen
// suite, so its own props, its bounded image-refresh budget and its accessibility
// contract had no direct cover at all.
import React, { createElement } from 'react'
import { run as runAxe } from 'axe-core'
import type * as ReactNativeModule from 'react-native'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityFeedItem } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

/**
 * `accessible` is a NATIVE-only prop. react-native-web's `forwardedProps` table has
 * no entry for it, so it never reaches the DOM and no DOM assertion can observe it.
 * Without it iOS VoiceOver skips the image entirely and the alt text the author
 * was made to confirm is never announced. The prop is therefore asserted where it is
 * actually handed over. The recorder renders the REAL `Image`, so the expiry effect,
 * the `onError` path and the axe scan below all still run against the real component.
 */
const imageSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
  // Filled in from this file's own React below. Importing `react` inside the mock
  // factory instantiates a second copy of it and every hook in the tree then reads
  // a null dispatcher.
  createElement: null as unknown as typeof createElement,
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const RealImage = actual.Image
  const RealView = actual.View
  function RecordingImage(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      imageSpy.props.set(props.testID, props)
    }
    return imageSpy.createElement(RealImage as never, props)
  }
  function RecordingView(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      viewSpy.props.set(props.testID, props)
    }
    return imageSpy.createElement(RealView as never, props)
  }
  const RealPressable = actual.Pressable
  function RecordingPressable(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      pressableSpy.props.set(props.testID, props)
    }
    return imageSpy.createElement(RealPressable as never, props)
  }
  return {
    ...actual,
    Image: RecordingImage,
    View: RecordingView,
    Pressable: RecordingPressable,
  }
})

/**
 * The card container is recorded for the same reason the image is: `accessible` is
 * native-only, so the DOM cannot show whether the card groups its children. On iOS
 * a grouped card announces one label and hides the alt text and both moderation
 * controls, while on web it stays a reachable region either way.
 */
const viewSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
}))

/** Same reason again for the photo's touch target: `accessible` never reaches the DOM. */
const pressableSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
}))

imageSpy.createElement = createElement

import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { CommunityCard } from './community-card'

/** A real 1x1 PNG: `ImageLoader` resolves it without touching the network. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function item(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 'post-a',
    caption: 'Layered wool over a merino base for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
    climateBand: 'temperate_wet',
    imageAccess: {
      url: PIXEL,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    publishedAt: '2026-09-05T12:00:00.000Z',
    createdAt: '2026-09-05T11:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer A1B2', isSelf: false },
    ...overrides,
  }
}

function renderCard(props: Partial<React.ComponentProps<typeof CommunityCard>> = {}) {
  const onReport = vi.fn()
  const onWithdraw = vi.fn()
  const onImageExpiry = vi.fn()
  const onOpen = vi.fn()
  const utils = render(
    <CommunityCard
      item={item()}
      onReport={onReport}
      onWithdraw={onWithdraw}
      onImageExpiry={onImageExpiry}
      onOpen={onOpen}
      {...props}
    />
  )
  return { ...utils, onReport, onWithdraw, onImageExpiry, onOpen }
}

describe('CommunityCard (Story 6.1)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    imageSpy.props.clear()
    viewSpy.props.clear()
    pressableSpy.props.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('6.1-MOB-030 is a labelled region whose CTAs are reachable', () => {
    renderCard()

    const card = screen.getByTestId('community-post-card-post-a')
    // `accessibilityRole="summary"` maps to the `region` landmark on web.
    expect(card.getAttribute('role')).toBe('region')
    expect(card.getAttribute('aria-label')).toBe('Look by Style Explorer A1B2')

    const report = screen.getByTestId('community-card-report-post-a')
    expect(card.contains(report)).toBe(true)
    report.focus()
    expect(document.activeElement).toBe(report)

    // Native contract: the container must NOT be `accessible`, or iOS collapses it
    // into a single element and the assertions above stop describing what is
    // announced. `toBeUndefined` rather than `toBe(false)`, because the prop is
    // absent rather than explicitly disabled.
    expect(viewSpy.props.get('community-post-card-post-a')?.accessible).toBeUndefined()
  })

  it('6.1-MOB-085 records an open from the photo without regrouping the card', () => {
    const { onOpen, onReport } = renderCard()

    press(screen.getByTestId('community-card-open-post-a'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(item())

    // The two native contracts a pressable card is most likely to break. The
    // container must still not group (iOS would announce one element and hide the
    // alt text and both controls), and the touch target itself must not group
    // either, which is why it is asserted as an explicit `false` rather than as
    // an absent prop the way the container is.
    expect(viewSpy.props.get('community-post-card-post-a')?.accessible).toBeUndefined()
    expect(pressableSpy.props.get('community-card-open-post-a')?.accessible).toBe(false)
    expect(imageSpy.props.get('community-card-image-post-a')?.accessible).toBe(true)

    const report = screen.getByTestId('community-card-report-post-a')
    report.focus()
    expect(document.activeElement).toBe(report)
    press(report)
    expect(onReport).toHaveBeenCalledTimes(1)
    // Reporting is not opening: the beta gate counts opens, so a control inside
    // the touch target must not inflate them.
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('6.1-MOB-086 reaches the same open from the image VoiceOver focuses', () => {
    const { onOpen } = renderCard()

    // `onAccessibilityTap` is native-only, so no DOM event can drive it. VoiceOver
    // activates the element it is focused on, which is the labelled image rather
    // than the wrapper, and without this handler the open would be a sighted-only
    // action in a measurement the beta gate reads.
    const onAccessibilityTap = imageSpy.props.get('community-card-image-post-a')
      ?.onAccessibilityTap as () => void
    onAccessibilityTap()

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('6.1-MOB-087 offers no open target while the image is unavailable', () => {
    const { onOpen } = renderCard({
      item: item({ imageAccess: { url: PIXEL, expiresAt: 'not-a-timestamp' } }),
    })

    expect(screen.queryByTestId('community-card-open-post-a')).toBeNull()
    press(screen.getByTestId('community-card-image-retry-post-a'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('6.1-MOB-031 marks the image accessible and labels it with the confirmed alt text', () => {
    renderCard()

    const image = screen.getByTestId('community-card-image-post-a')
    expect(image.getAttribute('role')).toBe('img')
    expect(image.getAttribute('aria-label')).toBe(item().altText)
    // Native contract: an `<Image>` carrying a label must also be `accessible`.
    expect(imageSpy.props.get('community-card-image-post-a')).toMatchObject({
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: item().altText,
    })
  })

  it('6.1-MOB-032 falls back through alt text, caption and the card label', () => {
    const { rerender } = renderCard({ item: item({ altText: null }) })
    expect(
      screen.getByTestId('community-card-image-post-a').getAttribute('aria-label')
    ).toBe(item().caption)

    rerender(
      <CommunityCard
        item={item({ altText: null, caption: null })}
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
      />
    )
    expect(
      screen.getByTestId('community-card-image-post-a').getAttribute('aria-label')
    ).toBe('Look by Style Explorer A1B2')
    expect(screen.queryByTestId('community-card-caption-post-a')).toBeNull()
  })

  it('6.1-MOB-033 names an unnamed author and an unclassified band from the catalogue', () => {
    renderCard({
      item: item({
        climateBand: null,
        author: { displayName: '   ', isSelf: false },
      }),
    })

    expect(screen.getByTestId('community-card-author-post-a').textContent).toBe(
      enUS.community.card.authorFallback
    )
    expect(screen.getByTestId('community-card-climate-pill-post-a').textContent).toBe(
      enUS.community.band.unclassified
    )
  })

  it('6.1-MOB-034 renders and announces the sponsored variant', () => {
    renderCard({ isSponsored: true })

    const badge = screen.getByTestId('community-card-sponsored-post-a')
    expect(badge.textContent).toBe(enUS.community.card.sponsored)
    expect(badge.getAttribute('aria-label')).toBe(enUS.community.card.sponsoredAnnounce)
    // The sponsorship rides on the card's own label too, so it is announced first.
    expect(
      screen.getByTestId('community-post-card-post-a').getAttribute('aria-label')
    ).toBe('Look by Style Explorer A1B2. Sponsored look')
  })

  it('6.1-MOB-088 emphasises the look a deep link landed on', () => {
    const { rerender } = renderCard()
    expect(screen.getByTestId('community-post-card-post-a').style.borderWidth).toBe('1px')

    rerender(
      <CommunityCard
        item={item()}
        isHighlighted
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
      />
    )
    // Border weight, not the gold alone: the emphasis has to survive a reader who
    // cannot separate the accent from the divider.
    expect(screen.getByTestId('community-post-card-post-a').style.borderWidth).toBe('2px')
  })

  it('6.1-MOB-035 offers Withdraw on an own look and Report on everyone else’s', () => {
    const { onWithdraw } = renderCard({
      item: item({ author: { displayName: 'You', isSelf: true } }),
    })

    expect(screen.getByTestId('community-card-author-post-a').textContent).toBe(
      enUS.community.card.authorSelf
    )
    expect(screen.queryByTestId('community-card-report-post-a')).toBeNull()
    press(screen.getByTestId('community-card-withdraw-post-a'))
    expect(onWithdraw).toHaveBeenCalledTimes(1)
  })

  it('6.1-MOB-036 settles the report control into a disabled Reported state', () => {
    const { onReport } = renderCard({ isReported: true })

    const control = screen.getByTestId('community-card-report-post-a')
    expect(control.textContent).toBe(enUS.community.card.reported)
    // The reason the control is dead is spoken, not implied by dimming.
    expect(control.getAttribute('aria-label')).toBe(enUS.community.card.reported)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    press(control)
    expect(onReport).not.toHaveBeenCalled()
  })

  it('6.1-MOB-037 badges a row that has not reached published', () => {
    const { rerender } = renderCard({ item: item({ status: 'pending_review' }) })
    expect(screen.getByTestId('community-card-status-post-a').textContent).toBe(
      enUS.community.status.pending_review
    )

    rerender(<CommunityCard item={item()} onReport={vi.fn()} onWithdraw={vi.fn()} />)
    expect(screen.queryByTestId('community-card-status-post-a')).toBeNull()
  })

  it('6.1-MOB-038 bounds the refresh budget for an expired URL, then offers a manual retry', () => {
    vi.useFakeTimers()
    const expired = item({
      imageAccess: { url: PIXEL, expiresAt: '2020-01-01T00:00:00.000Z' },
    })
    const onImageExpiry = vi.fn()
    render(
      <CommunityCard
        item={expired}
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
        onImageExpiry={onImageExpiry}
      />
    )

    // First attempt is immediate, the second waits out the backoff, and there is
    // no third: the first draft keyed this effect on the whole item, so every
    // refetch re-armed it and the card refreshed forever.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onImageExpiry).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(onImageExpiry).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onImageExpiry).toHaveBeenCalledTimes(2)

    const fallback = screen.getByTestId('community-card-image-unavailable-post-a')
    expect(fallback.textContent).toContain(enUS.community.card.imageUnavailable)
    expect(screen.queryByTestId('community-card-image-post-a')).toBeNull()

    // The manual retry restores the budget and asks for the image again.
    act(() => {
      press(screen.getByTestId('community-card-image-retry-post-a'))
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onImageExpiry).toHaveBeenCalledTimes(3)
  })

  it('6.1-MOB-081 spends the budget on a burst of load failures and stops there', () => {
    const onImageExpiry = vi.fn()
    render(
      <CommunityCard
        item={item({
          imageAccess: { url: PIXEL, expiresAt: '2020-01-01T00:00:00.000Z' },
        })}
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
        onImageExpiry={onImageExpiry}
      />
    )

    // react-native-web reports a broken image through `ImageLoader`, which no DOM
    // event can drive deterministically, so the handler the card actually passed
    // is invoked directly. Three failures in a row are one more than the budget.
    const onError = imageSpy.props.get('community-card-image-post-a')
      ?.onError as () => void
    act(() => {
      onError()
      onError()
      onError()
    })

    expect(onImageExpiry).toHaveBeenCalledTimes(2)
    expect(
      screen.getByTestId('community-card-image-unavailable-post-a')
    ).toBeInTheDocument()
  })

  it('6.1-MOB-039 treats an unparsable expiry as an unavailable image straight away', () => {
    const onImageExpiry = vi.fn()
    render(
      <CommunityCard
        item={item({ imageAccess: { url: PIXEL, expiresAt: 'not-a-timestamp' } })}
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
        onImageExpiry={onImageExpiry}
      />
    )

    expect(
      screen.getByTestId('community-card-image-unavailable-post-a')
    ).toBeInTheDocument()
    expect(onImageExpiry).not.toHaveBeenCalled()
  })

  it('6.1-MOB-040 keeps a live URL on screen and arms the refresh for its expiry', () => {
    vi.useFakeTimers()
    const onImageExpiry = vi.fn()
    render(
      <CommunityCard
        item={item({
          imageAccess: {
            url: PIXEL,
            expiresAt: new Date(Date.now() + 5_000).toISOString(),
          },
        })}
        onReport={vi.fn()}
        onWithdraw={vi.fn()}
        onImageExpiry={onImageExpiry}
      />
    )

    expect(screen.getByTestId('community-card-image-post-a')).toBeInTheDocument()
    expect(onImageExpiry).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5_100)
    })
    expect(onImageExpiry).toHaveBeenCalledTimes(1)
  })

  it('6.1-MOB-041 has no axe violations', async () => {
    const { container } = renderCard({ isSponsored: true })

    const results = await runAxe(container, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })

    // THE SCAN IS PROVED TO HAVE TAKEN A READING BEFORE ITS VERDICT IS BELIEVED.
    //
    // `violations` is empty both when the markup is clean and when there was no
    // markup to check, and the two are indistinguishable from the assertion
    // below. A changed testID, a prop guard returning null, or a render helper
    // that quietly stops mounting would all turn this into a green tick over an
    // empty container. `passes` counts rule/node pairs axe actually evaluated,
    // so a non-zero count is the instrument reporting that it read something.
    // Same anchor on 6.1-MOB-046 and 6.1-MOB-050; the two modal scans in this
    // directory already have one, because they wait on `role="dialog"` first.
    expect(results.passes.length, 'axe scanned an empty tree').toBeGreaterThan(0)

    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })
})
