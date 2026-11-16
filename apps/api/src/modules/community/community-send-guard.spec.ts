// TEA sign-off L-2: the claim bound is an option for fault-injection tests; it reaches a SET
// statement that takes no bind parameter, so only a positive integer is accepted.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_SEND_CLAIM_TIMEOUT_MS,
  CommunitySendGuard,
} from './community-send-guard.js'

const flags = { evaluate: () => Promise.resolve(true) } as never

describe('CommunitySendGuard claim bound', () => {
  it('is 500 ms in production', () => {
    expect(COMMUNITY_SEND_CLAIM_TIMEOUT_MS).toBe(500)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as the claim bound',
    (claimTimeoutMs) => {
      expect(
        () =>
          new CommunitySendGuard({} as PrismaClient, flags, undefined, { claimTimeoutMs })
      ).toThrow(`claimTimeoutMs must be a positive integer; got ${claimTimeoutMs}`)
    }
  )

  it('accepts a positive integer', () => {
    expect(
      () =>
        new CommunitySendGuard({} as PrismaClient, flags, undefined, {
          claimTimeoutMs: 5_000,
        })
    ).not.toThrow()
  })
})
