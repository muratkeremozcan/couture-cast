// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Round 4 (Codex C3-1): a commit owns its session's publication for a lease of the API
// function's maximum duration plus a margin. Erasure, purge and replacement that meet an
// unfinished publication defer the session's keys until that lease runs out.
import { ConflictException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import {
  AMBIGUOUS_PUBLICATION_HORIZON_MS,
  API_FUNCTION_MAX_DURATION_MS,
  ambiguousPublicationHorizon,
  nextCleanupHorizon,
  PUBLISH_CLAIM_LEASE_MS,
  PUBLISH_CLAIM_MARGIN_MS,
  staleClaimCutoff,
  unfinishedPublicationDeadline,
  uploadInProgress,
} from './wardrobe-publication'

const NOW = new Date('2026-11-19T12:00:00.000Z')

describe('publication lease', () => {
  it('lasts the function maximum duration (vercel.json maxDuration 25 s) plus five minutes', () => {
    expect(API_FUNCTION_MAX_DURATION_MS).toBe(25_000)
    expect(PUBLISH_CLAIM_MARGIN_MS).toBe(300_000)
    expect(PUBLISH_CLAIM_LEASE_MS).toBe(325_000)
  })

  it('treats claims started before one lease ago as stale', () => {
    expect(staleClaimCutoff(NOW)).toEqual(new Date(NOW.getTime() - 325_000))
  })
})

describe('unfinishedPublicationDeadline', () => {
  const startedAt = new Date(NOW.getTime() - 60_000)

  it('answers the end of the lease for a live claim on a committable session', () => {
    expect(
      unfinishedPublicationDeadline(
        { attemptId: 'attempt-1', startedAt, committable: true },
        NOW
      )
    ).toEqual(new Date(startedAt.getTime() + PUBLISH_CLAIM_LEASE_MS))
  })

  it.each([
    [
      'a session that already moved on',
      { attemptId: 'attempt-1', startedAt, committable: false },
    ],
    ['no claim', { attemptId: null, startedAt: null, committable: true }],
    [
      'a claim with no start time',
      { attemptId: 'attempt-1', startedAt: null, committable: true },
    ],
    [
      'a claim whose lease ran out',
      {
        attemptId: 'attempt-1',
        startedAt: new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS),
        committable: true,
      },
    ],
  ])('answers null for %s', (_label, claim) => {
    expect(unfinishedPublicationDeadline(claim, NOW)).toBeNull()
  })
})

/**
 * Round 5 (Codex C4-5): the lease bounds ownership, not when storage finishes a write it already
 * received, so a removal that meets a live claim repeats until 24 hours after the lease start.
 */
describe('ambiguousPublicationHorizon', () => {
  const startedAt = new Date(NOW.getTime() - 60_000)

  it('is 24 hours after the lease start while a publication is in flight', () => {
    expect(AMBIGUOUS_PUBLICATION_HORIZON_MS).toBe(24 * 60 * 60 * 1000)
    expect(
      ambiguousPublicationHorizon(
        { attemptId: 'attempt-1', startedAt, committable: true },
        NOW
      )
    ).toEqual(new Date(startedAt.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS))
  })

  it('is null when no publication is in flight', () => {
    expect(
      ambiguousPublicationHorizon(
        { attemptId: 'attempt-1', startedAt, committable: false },
        NOW
      )
    ).toBeNull()
    expect(
      ambiguousPublicationHorizon(
        { attemptId: null, startedAt: null, committable: true },
        NOW
      )
    ).toBeNull()
  })
})

/**
 * Round 6 (Codex C5-2): every claim records its cleanup horizon, and the horizon outlives the
 * lease, a takeover and success. A removal that meets an expired, taken-over or finished claim
 * still repeats until it, since a write the first attempt started can land after any of those.
 */
describe('recorded cleanup horizon', () => {
  const recorded = new Date(NOW.getTime() + 23 * 60 * 60 * 1000)

  it('still counts once the lease has run out', () => {
    const expiredStart = new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 60_000)
    expect(
      ambiguousPublicationHorizon(
        {
          attemptId: 'attempt-1',
          startedAt: expiredStart,
          committable: true,
          cleanupUntil: recorded,
        },
        NOW
      )
    ).toEqual(recorded)
  })

  it('still counts after the publication succeeded and its claim was cleared', () => {
    expect(
      ambiguousPublicationHorizon(
        { attemptId: null, startedAt: null, committable: false, cleanupUntil: recorded },
        NOW
      )
    ).toEqual(recorded)
  })

  it('stops counting once it has passed', () => {
    expect(
      ambiguousPublicationHorizon(
        {
          attemptId: null,
          startedAt: null,
          committable: false,
          cleanupUntil: new Date(NOW.getTime() - 1),
        },
        NOW
      )
    ).toBeNull()
  })

  it('takes the later of the recorded horizon and a live claim started without one', () => {
    const startedAt = new Date(NOW.getTime() - 60_000)
    const earlier = new Date(NOW.getTime() + 60_000)
    expect(
      ambiguousPublicationHorizon(
        { attemptId: 'attempt-1', startedAt, committable: true, cleanupUntil: earlier },
        NOW
      )
    ).toEqual(new Date(startedAt.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS))
  })

  it('is written 24 hours out by a new claim, and a takeover never moves it earlier', () => {
    expect(nextCleanupHorizon(null, NOW)).toEqual(
      new Date(NOW.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS)
    )
    const later = new Date(NOW.getTime() + 2 * AMBIGUOUS_PUBLICATION_HORIZON_MS)
    expect(nextCleanupHorizon(later, NOW)).toEqual(later)
  })
})

describe('uploadInProgress', () => {
  it('is a 409 UPLOAD_IN_PROGRESS', () => {
    const error = uploadInProgress()
    expect(error).toBeInstanceOf(ConflictException)
    expect(error.message).toBe('UPLOAD_IN_PROGRESS')
  })
})
