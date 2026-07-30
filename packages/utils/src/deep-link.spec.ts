import { describe, expect, it } from 'vitest'
import { hasDeepLinkIntent, parseDeepLink, resolveDeepLinkScenario } from './deep-link'

describe('parseDeepLink', () => {
  it('parses valid widget deep links with slot am', () => {
    const result = parseDeepLink({ source: 'widget', slot: 'am' })
    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({ source: 'widget', slot: 'am' })
  })

  it('parses valid widget deep links with slot now', () => {
    const result = parseDeepLink({ source: 'widget', slot: 'now' })
    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({ source: 'widget', slot: 'now' })
  })

  it('parses valid severe_weather notification deep links', () => {
    const result = parseDeepLink({
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-123',
    })
    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-123',
    })
  })

  it('parses valid community notification deep links', () => {
    const result = parseDeepLink({
      source: 'notification',
      type: 'community',
      cardId: 'card-456',
    })
    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({
      source: 'notification',
      type: 'community',
      cardId: 'card-456',
    })
  })

  it('handles array parameters from query string resolvers', () => {
    const result = parseDeepLink({ source: ['widget'], slot: ['evening'] })
    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({ source: 'widget', slot: 'evening' })
  })

  it('rejects invalid source parameter', () => {
    const result = parseDeepLink({ source: 'invalid_source', slot: 'am' })
    expect(result.valid).toBe(false)
    expect(result.errorReason).toContain('source')
  })

  it('rejects invalid slot parameter', () => {
    const result = parseDeepLink({ source: 'widget', slot: 'bad_slot' })
    expect(result.valid).toBe(false)
    expect(result.errorReason).toContain('slot')
  })

  it('rejects missing source parameter', () => {
    const result = parseDeepLink({ slot: 'am' })
    expect(result.valid).toBe(false)
    expect(result.errorReason).toBe('Missing source parameter')
  })

  it.each([
    [{ source: 'widget' }, 'slot'],
    [{ source: 'watch' }, 'slot'],
    [{ source: 'notification' }, 'type'],
    [{ source: 'notification', type: 'community' }, 'cardId'],
    [{ source: 'notification', type: 'severe_weather' }, 'alertId'],
  ])('rejects incomplete source-specific payload %o', (params, field) => {
    const result = parseDeepLink(params)
    expect(result.valid).toBe(false)
    expect(result.errorReason).toContain(field)
  })

  it('rejects an expired notification link', () => {
    const result = parseDeepLink(
      {
        source: 'notification',
        type: 'community',
        cardId: 'look-3',
        expiresAt: '2026-07-30T11:59:59.000Z',
      },
      new Date('2026-07-30T12:00:00.000Z')
    )
    expect(result).toEqual({ valid: false, errorReason: 'Deep link expired' })
  })

  it('maps fixed and forecast-relative widget slots to scenarios', () => {
    const context = {
      now: new Date('2026-07-30T13:00:00.000Z'),
      nextForecastAt: '2026-07-30T22:00:00.000Z',
      timeZone: 'America/New_York',
    }

    expect(resolveDeepLinkScenario('am', context)).toBe('morning')
    expect(resolveDeepLinkScenario('pm', context)).toBe('midday')
    expect(resolveDeepLinkScenario('evening', context)).toBe('evening')
    expect(resolveDeepLinkScenario('now', context)).toBe('morning')
    expect(resolveDeepLinkScenario('next', context)).toBe('evening')
  })
})

describe('hasDeepLinkIntent', () => {
  it('returns false for empty params', () => {
    expect(hasDeepLinkIntent({})).toBe(false)
  })

  it('returns true when source is present', () => {
    expect(hasDeepLinkIntent({ source: 'widget' })).toBe(true)
  })

  it('returns true when only slot is present', () => {
    expect(hasDeepLinkIntent({ slot: 'am' })).toBe(true)
  })

  it('returns true when only alertId is present', () => {
    expect(hasDeepLinkIntent({ alertId: 'alert-123' })).toBe(true)
  })

  it('returns true when only cardId is present', () => {
    expect(hasDeepLinkIntent({ cardId: 'look-42' })).toBe(true)
  })

  it('returns true when only expiresAt is present', () => {
    expect(hasDeepLinkIntent({ expiresAt: '2099-12-31T23:59:59.000Z' })).toBe(true)
  })

  it('returns false when all values are empty strings', () => {
    expect(hasDeepLinkIntent({ source: '', slot: '', type: '' })).toBe(false)
  })

  it('returns false when all values are null', () => {
    expect(hasDeepLinkIntent({ source: null, slot: null })).toBe(false)
  })

  it('returns false when all values are undefined', () => {
    expect(hasDeepLinkIntent({ source: undefined, slot: undefined })).toBe(false)
  })

  it('returns true when value is in an array', () => {
    expect(hasDeepLinkIntent({ source: ['widget'] })).toBe(true)
  })

  it('returns false for an array of empty strings', () => {
    expect(hasDeepLinkIntent({ source: ['', ''] })).toBe(false)
  })

  it('ignores non-intent keys', () => {
    expect(hasDeepLinkIntent({ unrelated: 'value', foo: 'bar' })).toBe(false)
  })
})
