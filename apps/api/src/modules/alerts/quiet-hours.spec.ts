import { describe, expect, it } from 'vitest'

import { evaluatePushSuppression } from './quiet-hours.js'

const enabledPreference = {
  pushEnabled: true,
  quietHoursEnabled: true,
  quietHoursStart: '09:00',
  quietHoursEnd: '17:00',
  timezone: 'UTC',
}

describe('evaluatePushSuppression', () => {
  it('uses start-inclusive and end-exclusive same-day boundaries', () => {
    expect(
      evaluatePushSuppression(enabledPreference, new Date('2026-07-13T09:00:00.000Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(enabledPreference, new Date('2026-07-13T16:59:59.999Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(enabledPreference, new Date('2026-07-13T17:00:00.000Z'))
    ).toEqual({ suppressed: false })
  })

  it('uses start-inclusive and end-exclusive overnight boundaries', () => {
    const preference = {
      ...enabledPreference,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    }

    expect(
      evaluatePushSuppression(preference, new Date('2026-07-13T22:00:00.000Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(preference, new Date('2026-07-14T06:59:59.999Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(preference, new Date('2026-07-14T07:00:00.000Z'))
    ).toEqual({ suppressed: false })
  })

  it('evaluates the instant in the configured IANA timezone', () => {
    const preference = {
      ...enabledPreference,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Chicago',
    }

    expect(
      evaluatePushSuppression(preference, new Date('2026-07-14T03:00:00.000Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(preference, new Date('2026-07-14T12:00:00.000Z'))
    ).toEqual({ suppressed: false })
  })

  it('uses civil time correctly across the America/Chicago DST jump', () => {
    const preference = {
      ...enabledPreference,
      quietHoursStart: '01:30',
      quietHoursEnd: '03:30',
      timezone: 'America/Chicago',
    }

    expect(
      evaluatePushSuppression(preference, new Date('2026-03-08T07:30:00.000Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(preference, new Date('2026-03-08T08:00:00.000Z'))
    ).toEqual({ suppressed: true, reason: 'quiet_hours' })
    expect(
      evaluatePushSuppression(preference, new Date('2026-03-08T08:30:00.000Z'))
    ).toEqual({ suppressed: false })
  })

  it('fails safe when persisted timezone or time data is invalid', () => {
    expect(
      evaluatePushSuppression(
        { ...enabledPreference, timezone: 'Not/A_Timezone' },
        new Date('2026-07-13T12:00:00.000Z')
      )
    ).toEqual({ suppressed: true, reason: 'invalid_timezone' })
    expect(
      evaluatePushSuppression(
        { ...enabledPreference, quietHoursStart: '25:00' },
        new Date('2026-07-13T12:00:00.000Z')
      )
    ).toEqual({ suppressed: true, reason: 'invalid_quiet_hours' })
    expect(
      evaluatePushSuppression(
        {
          ...enabledPreference,
          quietHoursStart: '09:00',
          quietHoursEnd: '09:00',
        },
        new Date('2026-07-13T12:00:00.000Z')
      )
    ).toEqual({ suppressed: true, reason: 'invalid_quiet_hours' })
  })

  it('honors push opt-out before quiet-hour evaluation', () => {
    expect(
      evaluatePushSuppression(
        {
          ...enabledPreference,
          pushEnabled: false,
          timezone: 'Not/A_Timezone',
        },
        new Date('2026-07-13T12:00:00.000Z')
      )
    ).toEqual({ suppressed: true, reason: 'push_disabled' })
  })

  it('does not inspect timezone when quiet hours are disabled', () => {
    expect(
      evaluatePushSuppression(
        {
          ...enabledPreference,
          quietHoursEnabled: false,
          timezone: 'Not/A_Timezone',
        },
        new Date('2026-07-13T12:00:00.000Z')
      )
    ).toEqual({ suppressed: false })
  })
})
