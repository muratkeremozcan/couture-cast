import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import type { DefaultApi } from '@couture/api-client'
import {
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'

const { eachLike, like, nullValue, regex, string } = MatchersV3

type ContractApiClient = Pick<DefaultApi, 'apiHealthGet' | 'apiV1EventsPollGet'>
type CreateClient = (mockServer: V3MockServer) => ContractApiClient

const isoTimestamp = (value: string) =>
  regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)

export async function verifyApiHealthInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .uponReceiving('a request for API health metadata')
    .withRequest('GET', '/api/health')
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          status: 'ok',
          service: 'couturecast-api',
          environment: string('preview'),
          gitSha: string('abc123'),
          gitBranch: string('main'),
          timestamp: isoTimestamp('2026-05-16T12:00:00.000Z'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiHealthGet()

      expect(apiHealthResponseSchema.parse(response)).toMatchObject({
        status: 'ok',
        service: 'couturecast-api',
      })
    })
}

export async function verifyEventsPollInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const since = '2026-05-16T12:00:00.000Z'
  const event = {
    id: 'evt-1',
    channel: 'alerts',
    payload: { severity: 'warning' },
    userId: 'guardian-1',
    createdAt: '2026-05-16T12:01:00.000Z',
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A warning alert event exists after the polling cursor',
        params: { since, event },
      })
    )
    .uponReceiving('a request to poll realtime fallback events')
    .withRequest('GET', '/api/v1/events/poll', setJsonContent({ query: { since } }))
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          events: eachLike({
            id: string(event.id),
            channel: string(event.channel),
            payload: like(event.payload),
            userId: string(event.userId),
            createdAt: isoTimestamp(event.createdAt),
          }),
          nextSince: isoTimestamp(event.createdAt),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1EventsPollGet({ since })

      expect(eventsPollResponseSchema.parse(response)).toEqual({
        events: [event],
        nextSince: event.createdAt,
      })
    })
}

export async function verifyInvalidCursorInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .uponReceiving('a request to poll events with an invalid cursor')
    .withRequest(
      'GET',
      '/api/v1/events/poll',
      setJsonContent({ query: { since: 'not-a-date' } })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          events: like([]),
          nextSince: nullValue(),
          error: string('Invalid since timestamp'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1EventsPollGet({
        since: 'not-a-date',
      })

      expect(eventsPollInvalidSinceResponseSchema.parse(response)).toEqual({
        events: [],
        nextSince: null,
        error: 'Invalid since timestamp',
      })
    })
}
