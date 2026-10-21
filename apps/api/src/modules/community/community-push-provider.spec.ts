import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommunityPushProvider,
  type CommunityPushMessage,
} from './community-push-provider.js'
const message: CommunityPushMessage = {
  to: 'ExpoPushToken[fixture]',
  title: 'CoutureCast',
  body: 'New engagement',
  data: {
    version: 1,
    notificationId: '65000000-0000-4000-8000-000000000001',
    source: 'notification',
    type: 'community',
    cardId: 'post',
    expiresAt: '2026-10-22T00:00:00Z',
  },
}
afterEach(() => vi.unstubAllEnvs())
describe('single provider invocation boundary', () => {
  it('cancellation before invocation makes no external request', async () => {
    const transport = vi.fn<typeof fetch>()
    await expect(
      new CommunityPushProvider(transport).send(message, AbortSignal.abort())
    ).rejects.toThrow('cancelled')
    expect(transport).not.toHaveBeenCalled()
  })
  it.each([null, 'unexpected', {}, [], { data: [] }, { data: { status: 'ok' } }])(
    'keeps malformed or incomplete tickets terminally uncertain: %j',
    async (body) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
      expect(
        await new CommunityPushProvider(transport).send(
          message,
          new AbortController().signal
        )
      ).toEqual({ status: 'unknown', reason: 'ambiguous_response' })
      expect(transport).toHaveBeenCalledTimes(1)
    }
  )
  it.each([false, true])(
    'passes one exact request and explicit provider credentials when configured=%s',
    async (credential) => {
      vi.stubEnv(
        'EXPO_PUSH_ACCESS_TOKEN',
        credential ? 'fixture-provider-credential' : ''
      )
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ data: [{ status: 'ok', id: 'ticket' }] }))
      const signal = new AbortController().signal
      expect(
        await new CommunityPushProvider(transport, 'https://provider.invalid/send').send(
          message,
          signal
        )
      ).toEqual({ status: 'accepted', ticketId: 'ticket' })
      expect(transport).toHaveBeenCalledExactlyOnceWith('https://provider.invalid/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credential ? { Authorization: 'Bearer fixture-provider-credential' } : {}),
        },
        body: JSON.stringify(message),
        signal,
      })
    }
  )
})
