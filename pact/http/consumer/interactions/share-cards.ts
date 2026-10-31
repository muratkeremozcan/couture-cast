// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { expect } from 'vitest'
import { ResponseError, shareCardsClient } from '@couture/api-client'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { pactEventHeaders, type CreateClient } from './shared'

const prepared = 'An eligible member prepares a share card'
const shareOn = 'Native share is on for the share-card member'
const shareOff = 'Native share is off for the share-card member'
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
  // Story 6.9 D3: share reauthorizes like save. The 6.8 entries above stay as they
  // are, so an old client keeps verifying against the new server.
  { kind: 'outfit', purpose: 'share', id: 'owned-outfit', status: 200, state: shareOn },
  {
    kind: 'community_post',
    purpose: 'share',
    id: 'owned-post',
    status: 200,
    state: shareOn,
  },
  { kind: 'outfit', purpose: 'share', id: 'flag-off', status: 403, state: shareOff },
  {
    kind: 'community_post',
    purpose: 'share',
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
          purpose: scenario.purpose,
          expectedSha256: preparedShareCardFixture.sha256,
        }
  const code =
    scenario.status === 403
      ? scenario.state === shareOff
        ? 'share_disabled'
        : 'denied'
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

/**
 * Story 6.9 D4: the per-member capabilities read. `absent` is a pre-6.9 server with no
 * route (new client, old server): the client must read it as off, never as an error.
 */
export const shareCardCapabilityInteractions = [
  { name: 'on', state: shareOn, status: 200, nativeShare: true },
  { name: 'off', state: shareOff, status: 200, nativeShare: false },
  {
    name: 'absent',
    state: 'The share-card capabilities route is absent',
    status: 404,
    nativeShare: false,
  },
] as const
export async function verifyShareCardCapabilityInteraction(
  pact: PactV4,
  createClient: CreateClient,
  scenario: (typeof shareCardCapabilityInteractions)[number]
) {
  await pact
    .addInteraction()
    .given(...createProviderState({ name: scenario.state, params: {} }))
    .uponReceiving(`a share-card capabilities read with native share ${scenario.name}`)
    .withRequest(
      'GET',
      '/api/v1/share-cards/capabilities',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      scenario.status,
      scenario.status === 200
        ? setJsonContent({
            headers: { 'Cache-Control': 'private, no-store' },
            body: { data: { nativeShare: scenario.nativeShare } },
          })
        : undefined
    )
    .executeTest(async (server: V3MockServer) => {
      expect(await shareCardsClient(createClient(server)).capabilities()).toEqual({
        nativeShare: scenario.nativeShare,
      })
    })
}
