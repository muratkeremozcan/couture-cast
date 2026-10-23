import { describe, expect, it } from 'vitest'
import {
  decodeLocationCandidate,
  encodeLocationCandidate,
  InvalidLocationCandidateError,
  LOCATION_CANDIDATE_TTL_MS,
  resolveLocationCandidateSecret,
} from './location-candidate-token'

const secret = 'location-candidate-secret-for-tests-0123456789'
const otherEnvironmentSecret = 'another-environment-secret-for-tests-987654321'
const issuedAt = new Date('2026-10-22T12:00:00.000Z')
const candidate = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
}

describe('location candidate token', () => {
  it('1.2b-UNIT-TOKEN-01 round-trips the canonical fields and nothing else', () => {
    const token = encodeLocationCandidate(candidate, secret, issuedAt)

    expect(decodeLocationCandidate(token, secret, issuedAt)).toEqual(candidate)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')
    ) as Record<string, unknown>
    // Identity-free: a replay by another member carries nothing about the issuer.
    expect(Object.keys(payload).sort()).toEqual(
      ['city', 'country', 'expiresAt', 'latitude', 'longitude', 'region', 'v'].sort()
    )
  })

  it('1.2b-UNIT-TOKEN-02 is valid until 15 minutes and refused at 15 minutes', () => {
    const token = encodeLocationCandidate(candidate, secret, issuedAt)

    expect(() =>
      decodeLocationCandidate(
        token,
        secret,
        new Date(issuedAt.getTime() + LOCATION_CANDIDATE_TTL_MS - 1)
      )
    ).not.toThrow()
    expect(() =>
      decodeLocationCandidate(
        token,
        secret,
        new Date(issuedAt.getTime() + LOCATION_CANDIDATE_TTL_MS)
      )
    ).toThrow(InvalidLocationCandidateError)
  })

  it("1.2b-UNIT-TOKEN-03 refuses another environment's secret", () => {
    const token = encodeLocationCandidate(candidate, otherEnvironmentSecret, issuedAt)

    expect(() => decodeLocationCandidate(token, secret, issuedAt)).toThrow(
      InvalidLocationCandidateError
    )
  })

  it('1.2b-UNIT-TOKEN-04 refuses an edited payload under the original signature', () => {
    const [, signature] = encodeLocationCandidate(candidate, secret, issuedAt).split('.')
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        ...candidate,
        latitude: 0,
        expiresAt: issuedAt.getTime() + 60_000,
      })
    ).toString('base64url')

    expect(() =>
      decodeLocationCandidate(`${forged}.${signature}`, secret, issuedAt)
    ).toThrow(InvalidLocationCandidateError)
  })

  it.each(['', 'abc', 'a.b.c', '.sig', 'payload.'])(
    '1.2b-UNIT-TOKEN-05 refuses the malformed token %j',
    (token) => {
      expect(() => decodeLocationCandidate(token, secret, issuedAt)).toThrow(
        InvalidLocationCandidateError
      )
    }
  )
})

describe('resolveLocationCandidateSecret', () => {
  it('1.2b-UNIT-TOKEN-06 uses a configured secret of at least 32 characters', () => {
    expect(
      resolveLocationCandidateSecret({ LOCATION_CANDIDATE_SECRET: ` ${secret} ` })
    ).toBe(secret)
  })

  it('1.2b-UNIT-TOKEN-07 fails closed in a deployed environment without a usable secret', () => {
    expect(resolveLocationCandidateSecret({ NODE_ENV: 'production' })).toBeNull()
    expect(
      resolveLocationCandidateSecret({
        VERCEL_ENV: 'preview',
        LOCATION_CANDIDATE_SECRET: 'short',
      })
    ).toBeNull()
  })

  it('1.2b-UNIT-TOKEN-08 falls back to a test secret only in local and test runtimes', () => {
    expect(resolveLocationCandidateSecret({ NODE_ENV: 'test' })).toEqual(
      expect.any(String)
    )
    expect(resolveLocationCandidateSecret({ TEST_ENV: 'local' })).toEqual(
      expect.any(String)
    )
  })
})
