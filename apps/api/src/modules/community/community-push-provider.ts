// Story 6.5 owner: exactly one abortable HTTP invocation per durable token attempt.
import {
  classifyCommunityTicket,
  type CommunityPushOutcome,
} from './community-push-policy.js'

export type CommunityPushMessage = {
  to: string
  title: string
  body: string
  data: {
    version: 1
    notificationId: string
    source: 'notification'
    type: 'community'
    cardId: string
    commentId?: string
    parentId?: string
    expiresAt: string
  }
}
export class CommunityPushProvider {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly endpoint = 'https://exp.host/--/api/v2/push/send'
  ) {}
  async send(
    message: CommunityPushMessage,
    signal: AbortSignal
  ): Promise<CommunityPushOutcome> {
    if (signal.aborted) throw new Error('Community send cancelled before invocation.')
    try {
      const response = await this.transport(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EXPO_PUSH_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(message),
        signal,
      })
      // Generic 5xx, malformed tickets and transport failures cannot prove rejection.
      if (!response.ok) return { status: 'unknown', reason: 'ambiguous_response' }
      const raw: unknown = await response.json()
      if (!raw || typeof raw !== 'object' || !('data' in raw))
        return { status: 'unknown', reason: 'ambiguous_response' }
      return classifyCommunityTicket(Array.isArray(raw.data) ? raw.data[0] : raw.data)
    } catch {
      return { status: 'unknown', reason: 'transport' }
    }
  }
}
