import { describe, expect, it } from 'vitest'
import type { PolledEvent } from '../src/contracts/http/events'
import {
  createCommunityPolledEvent,
  createWeatherAlertPolledEvent,
} from '../src/testing/deep-link-events'
import {
  resolveCommunityCardDeepLinkTarget,
  resolveWeatherAlertDeepLinkTarget,
} from '../src/types/deep-link-targets'

function at(event: PolledEvent, createdAt: string): PolledEvent {
  return { ...event, createdAt }
}

const OLDER = '2026-07-30T10:00:00.000Z'
const NEWER = '2026-07-30T14:00:00.000Z'

describe('resolveWeatherAlertDeepLinkTarget', () => {
  // A push notification tapped with no alert id should open whatever the user
  // would see at the top of the feed, which is the newest alert.
  it('returns the newest weather alert when no alert id is requested', () => {
    const older = at(createWeatherAlertPolledEvent('alert-old', 'user-1'), OLDER)
    const newer = at(createWeatherAlertPolledEvent('alert-new', 'user-1'), NEWER)

    expect(resolveWeatherAlertDeepLinkTarget([older, newer])?.id).toBe('alert-new')
    // Input order must not change the answer; the resolver sorts by recency.
    expect(resolveWeatherAlertDeepLinkTarget([newer, older])?.id).toBe('alert-new')
  })

  it('returns the requested alert even when a newer one exists', () => {
    const older = at(createWeatherAlertPolledEvent('alert-old', 'user-1'), OLDER)
    const newer = at(createWeatherAlertPolledEvent('alert-new', 'user-1'), NEWER)

    const target = resolveWeatherAlertDeepLinkTarget([older, newer], 'alert-old')

    expect(target?.id).toBe('alert-old')
    expect(target?.event.data).toMatchObject({
      alertType: 'severe',
      severity: 'critical',
    })
  })

  it('returns undefined when the requested alert id is not in the feed', () => {
    const events = [at(createWeatherAlertPolledEvent('alert-old', 'user-1'), OLDER)]

    expect(resolveWeatherAlertDeepLinkTarget(events, 'alert-missing')).toBeUndefined()
  })

  // Polled feeds mix channels; a lookbook event must never satisfy an alert
  // deep link even though both carry the same envelope shape.
  it('ignores events from other realtime channels', () => {
    const community = at(createCommunityPolledEvent('post-1', 'user-1'), NEWER)

    expect(resolveWeatherAlertDeepLinkTarget([community])).toBeUndefined()
  })

  // The payload comes from the server as `unknown`; a malformed one must be
  // skipped rather than deep-linking into a screen with missing fields.
  it('skips an alert whose payload fails the socket contract and falls through', () => {
    const malformed: PolledEvent = {
      ...at(createWeatherAlertPolledEvent('alert-bad', 'user-1'), NEWER),
      payload: { version: '1', timestamp: NEWER, userId: 'user-1', data: {} },
    }
    const valid = at(createWeatherAlertPolledEvent('alert-good', 'user-1'), OLDER)

    expect(resolveWeatherAlertDeepLinkTarget([malformed, valid])?.id).toBe('alert-good')
  })

  it('returns undefined for an empty feed', () => {
    expect(resolveWeatherAlertDeepLinkTarget([])).toBeUndefined()
  })
})

describe('resolveCommunityCardDeepLinkTarget', () => {
  // The community deep link is keyed on the post id inside the payload, not on
  // the envelope id, so a matching envelope id must not be enough.
  it('matches on the payload postId rather than the envelope id', () => {
    const events = [
      at(createCommunityPolledEvent('post-1', 'user-1'), OLDER),
      at(createCommunityPolledEvent('post-2', 'user-1'), NEWER),
    ]

    const target = resolveCommunityCardDeepLinkTarget(events, 'post-1')

    expect(target?.id).toBe('post-1')
    expect(target?.event.data.postId).toBe('post-1')
  })

  it('returns undefined when no card carries the requested postId', () => {
    const events = [at(createCommunityPolledEvent('post-1', 'user-1'), NEWER)]

    expect(resolveCommunityCardDeepLinkTarget(events, 'post-9')).toBeUndefined()
  })

  it('ignores weather alert events when resolving a community card', () => {
    const alert = at(createWeatherAlertPolledEvent('alert-1', 'user-1'), NEWER)

    expect(resolveCommunityCardDeepLinkTarget([alert], 'alert-1')).toBeUndefined()
  })

  it('skips a community event whose payload fails the socket contract', () => {
    const malformed: PolledEvent = {
      ...at(createCommunityPolledEvent('post-1', 'user-1'), NEWER),
      payload: {
        version: '',
        timestamp: NEWER,
        userId: 'user-1',
        data: { postId: 'post-1' },
      },
    }

    expect(resolveCommunityCardDeepLinkTarget([malformed], 'post-1')).toBeUndefined()
  })

  // Duplicate lookbook events for one post can arrive after a reconnect; the
  // newest copy is the one the card should render.
  it('prefers the newest event when the same post is delivered twice', () => {
    const older: PolledEvent = {
      ...at(createCommunityPolledEvent('post-1', 'user-1'), OLDER),
      id: 'event-old',
      payload: {
        version: '1',
        timestamp: OLDER,
        userId: 'user-1',
        data: { postId: 'post-1', climateBand: 'Cold-snap' },
      },
    }
    const newer: PolledEvent = {
      ...at(createCommunityPolledEvent('post-1', 'user-1'), NEWER),
      id: 'event-new',
      payload: {
        version: '1',
        timestamp: NEWER,
        userId: 'user-1',
        data: { postId: 'post-1', climateBand: 'Rain-ready' },
      },
    }

    expect(
      resolveCommunityCardDeepLinkTarget([older, newer], 'post-1')?.event.data.climateBand
    ).toBe('Rain-ready')
  })
})
