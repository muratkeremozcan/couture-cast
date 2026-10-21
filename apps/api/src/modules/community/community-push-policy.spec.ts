import { describe, expect, it } from 'vitest'
import {
  nextAllowedCommunityInstant,
  classifyCommunityTicket,
} from './community-push-policy.js'
const expires = (now: string) => new Date(Date.parse(now) + 86_400_000)
const policy = {
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'America/Chicago',
}
describe('Story 6.5 notification policy', () => {
  it('6.5-UNIT-001: uses inclusive start, exclusive end and midnight-spanning local labels', () => {
    for (const [now, status] of [
      ['2026-10-20T02:59:59Z', 'allowed'],
      ['2026-10-20T03:00:00Z', 'deferred'],
      ['2026-10-20T12:00:00Z', 'allowed'],
    ] as const)
      expect(
        nextAllowedCommunityInstant(policy, new Date(now), expires(now)).status
      ).toBe(status)
  })
  it('6.5-UNIT-002: spring gaps and fall repeats are evaluated through actual UTC instants', () => {
    const spring = '2026-03-08T07:30:00Z'
    expect(
      nextAllowedCommunityInstant(
        { ...policy, quietHoursEnd: '02:30' },
        new Date(spring),
        expires(spring)
      )
    ).toEqual({ status: 'deferred', at: new Date('2026-03-08T08:00:00Z') })
    const fall = '2026-11-01T06:30:00Z'
    expect(
      nextAllowedCommunityInstant(
        { ...policy, quietHoursEnd: '02:00' },
        new Date(fall),
        expires(fall)
      )
    ).toEqual({ status: 'deferred', at: new Date('2026-11-01T08:00:00Z') })
  })
  it('6.5-UNIT-003: expiry wins; corrupt or equal quiet windows fail closed', () => {
    const now = new Date('2026-10-20T04:00:00Z')
    expect(nextAllowedCommunityInstant(policy, now, now)).toEqual({ status: 'expired' })
    expect(
      nextAllowedCommunityInstant(
        { ...policy, timezone: 'invalid' },
        now,
        expires(now.toISOString())
      )
    ).toEqual({ status: 'invalid_policy' })
    expect(
      nextAllowedCommunityInstant(
        { ...policy, quietHoursEnd: '22:00' },
        now,
        expires(now.toISOString())
      )
    ).toEqual({ status: 'invalid_policy' })
  })
  it('6.5-UNIT-004: only explicit known rejections permit retry; ambiguous responses are terminal uncertainty', () => {
    expect(classifyCommunityTicket({ status: 'ok', id: 'ticket' })).toEqual({
      status: 'accepted',
      ticketId: 'ticket',
    })
    expect(
      classifyCommunityTicket({
        status: 'error',
        details: { error: 'MessageRateExceeded' },
      }).status
    ).toBe('retryable_rejection')
    expect(
      classifyCommunityTicket({
        status: 'error',
        details: { error: 'DeviceNotRegistered' },
      }).status
    ).toBe('invalid_token')
    for (const value of [
      undefined,
      {},
      { status: 'ok' },
      { status: 'error', details: { error: 'Unknown' } },
    ])
      expect(classifyCommunityTicket(value).status).toBe('unknown')
  })
})
