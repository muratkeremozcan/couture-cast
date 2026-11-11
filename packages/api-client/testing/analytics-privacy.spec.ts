import { describe, expect, it } from 'vitest'
import { PERSONAL_ANALYTICS_PROPERTY_KEYS, stripPersonalAnalyticsData } from '../src'

type Event = {
  event: string
  properties?: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

describe('stripPersonalAnalyticsData: no email, name or birthdate leaves an SDK', () => {
  it('names email, name and birthdate keys in the frozen denylist', () => {
    expect(PERSONAL_ANALYTICS_PROPERTY_KEYS).toEqual(
      expect.arrayContaining(['email', 'name', 'birthdate', 'date_of_birth'])
    )
    expect(Object.isFrozen(PERSONAL_ANALYTICS_PROPERTY_KEYS)).toBe(true)
  })

  it('removes personal keys from properties and from top-level and nested person updates', () => {
    const event: Event = {
      event: '$pageview',
      properties: {
        $current_url: 'https://couturecast.app/',
        locale: 'en-US',
        email: 'member@example.test',
        $name: 'Teen Member',
        firstName: 'Teen',
        'Date-Of-Birth': '2011-04-01',
        $set: { email: 'member@example.test', plan: 'premium' },
        $set_once: { birthdate: '2011-04-01', $initial_referrer: '$direct' },
      },
      $set: { display_name: 'Teen Member', plan: 'premium' },
      $set_once: { BIRTHDAY: '04-01', first_seen: 'today' },
    }
    expect(stripPersonalAnalyticsData(event)).toEqual({
      event: '$pageview',
      properties: {
        $current_url: 'https://couturecast.app/',
        locale: 'en-US',
        $set: { plan: 'premium' },
        $set_once: { $initial_referrer: '$direct' },
      },
      $set: { plan: 'premium' },
      $set_once: { first_seen: 'today' },
    })
    // The caller's event is left as it was.
    expect(event.properties).toHaveProperty('email', 'member@example.test')
  })

  it('returns a clean event by reference and passes null through', () => {
    const clean: Event = {
      event: 'ritual_created',
      properties: { locale: 'en-US', $device_name: 'iPhone', $app_name: 'CoutureCast' },
      $set: { plan: 'premium' },
    }
    expect(stripPersonalAnalyticsData(clean)).toBe(clean)
    expect(stripPersonalAnalyticsData({ event: 'no_properties' })).toEqual({
      event: 'no_properties',
    })
    expect(stripPersonalAnalyticsData(null)).toBeNull()
  })

  it('leaves non-object person updates alone', () => {
    const event = { event: 'odd', properties: 'not-an-object', $set: ['email'] }
    expect(stripPersonalAnalyticsData(event)).toBe(event)
  })

  it('drops the event instead of throwing when reading it fails', () => {
    const hostile = Object.defineProperty({ event: 'x' }, 'properties', {
      enumerable: true,
      get() {
        throw new Error('member@example.test')
      },
    })
    expect(() => stripPersonalAnalyticsData(hostile)).not.toThrow()
    expect(stripPersonalAnalyticsData(hostile)).toBeNull()
  })
})
