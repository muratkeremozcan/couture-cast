// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  encodeCommunityCursor,
  decodeCommunityCursor,
  type CommunityCursor,
} from './community-cursor.js'
afterEach(() => vi.unstubAllEnvs())
describe('signed community cursor refusal', () => {
  it('rejects truncated, surplus, forged and foreign-scope cursors', () => {
    vi.stubEnv('ANALYTICS_ID_SECRET', 'fixture-cursor-signing-key-with-enough-length')
    const value: CommunityCursor = {
      version: 1,
      member: 'owner',
      mode: 'all',
      band: null,
      public: { epoch: '65000000-0000-4000-8000-000000000001', position: '0' },
      private: { epoch: '65000000-0000-4000-8000-000000000002', position: '0' },
    }
    const cursor = encodeCommunityCursor(value)
    expect(decodeCommunityCursor(cursor, 'owner', 'all')).toEqual(value)
    for (const malformed of [
      '',
      '.',
      'payload.',
      `${cursor}.extra`,
      `${cursor}x`,
      `${cursor.slice(0, -1)}!`,
    ])
      expect(() => decodeCommunityCursor(malformed, 'owner', 'all')).toThrow(
        'Invalid community cursor'
      )
    expect(() => decodeCommunityCursor(cursor, 'other-owner', 'all')).toThrow()
    expect(() => decodeCommunityCursor(cursor, 'owner', 'auto')).toThrow()
  })
})
