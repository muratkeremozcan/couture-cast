import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { expect } from 'vitest'
import { ResponseError, shareCardsClient } from '@couture/api-client'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { pactEventHeaders, type CreateClient } from './shared'

const prepared = 'An eligible member prepares a share card'
// Each refusal names its own provider state; the request ids are labels only.
export const shareCardInteractions = [
  {
    kind: 'outfit',
    purpose: 'preview',
    id: 'owned-outfit',
    status: 200,
    state: prepared,
  },
  {
    kind: 'community_post',
    purpose: 'preview',
    id: 'owned-post',
    status: 200,
    state: prepared,
  },
  { kind: 'outfit', purpose: 'save', id: 'owned-outfit', status: 200, state: prepared },
  {
    kind: 'community_post',
    purpose: 'save',
    id: 'owned-post',
    status: 200,
    state: prepared,
  },
  {
    kind: 'outfit',
    purpose: 'preview',
    id: 'denied',
    status: 403,
    state: 'The share-card member is denied',
  },
  {
    kind: 'community_post',
    purpose: 'preview',
    id: 'missing',
    status: 404,
    state: 'The share-card source is unavailable',
  },
  {
    kind: 'community_post',
    purpose: 'save',
    id: 'changed',
    status: 409,
    state: 'The share-card preview changed',
  },
] as const
export async function verifyShareCardInteraction(
  pact: PactV4,
  createClient: CreateClient,
  scenario: (typeof shareCardInteractions)[number]
) {
  const source =
    scenario.kind === 'outfit'
      ? { kind: 'outfit' as const, recommendationId: scenario.id }
      : { kind: 'community_post' as const, postId: scenario.id }
  const options = { source, locale: 'en-US' as const, watermark: true }
  const input =
    scenario.purpose === 'preview'
      ? { ...options, purpose: 'preview' as const }
      : {
          ...options,
          purpose: 'save' as const,
          expectedSha256: preparedShareCardFixture.sha256,
        }
  const code =
    scenario.status === 403
      ? 'denied'
      : scenario.status === 404
        ? 'source_unavailable'
        : 'preview_changed'
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: scenario.state,
        params: {},
      })
    )
    .uponReceiving(`a ${scenario.kind} share-card ${scenario.purpose} for ${scenario.id}`)
    .withRequest(
      'POST',
      '/api/v1/share-cards/prepare',
      setJsonContent({ headers: pactEventHeaders, body: input })
    )
    .willRespondWith(
      scenario.status,
      setJsonContent({
        body:
          scenario.status === 200
            ? { data: preparedShareCardFixture }
            : { statusCode: scenario.status, code, message: code },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      if (scenario.status === 200)
        expect(await shareCardsClient(createClient(server)).prepare(input)).toEqual(
          preparedShareCardFixture
        )
      else {
        const failure = await shareCardsClient(createClient(server))
          .prepare(input)
          .catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(ResponseError)
        const response = (failure as ResponseError).response
        expect(response.status).toBe(scenario.status)
        expect(await response.json()).toEqual({
          statusCode: scenario.status,
          code,
          message: code,
        })
      }
    })
}
