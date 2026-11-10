// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { premiumAccessResponseSchema } from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { pactEventAuth, pactEventHeaders, string, type CreateClient } from './shared'

/* ---------------------------------------------------------------------------
 * Story 6.14 premium access source (D6).
 *
 * Web and mobile both read `GET /api/v1/commerce/premium/access` to decide
 * whether settings show the "Complimentary access" state and hide every
 * subscribe or purchase control. The two answers a client renders differently
 * are recorded: a complimentary member and a member with no premium. WHEN each
 * answer is produced (grant, kill switch, paid row precedence, read failure) is
 * proven in the API integration suites; this records the shape and the
 * discriminant a client must understand.
 * ------------------------------------------------------------------------- */

async function verifyPremiumAccessInteraction(
  pact: PactV4,
  createClient: CreateClient,
  arrangement: {
    state: string
    description: string
    premium: boolean
    source: 'complimentary' | 'none'
  }
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: arrangement.state,
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(arrangement.description)
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/access',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        // Both fields are pinned: `source` is the discriminant clients switch on,
        // and `premium` must agree with it.
        body: { data: { premium: arrangement.premium, source: arrangement.source } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumAccessGet()

      const parsed = premiumAccessResponseSchema.parse(response)
      expect(parsed).toEqual({
        data: { premium: arrangement.premium, source: arrangement.source },
      })
    })
}

export function verifyComplimentaryPremiumAccessInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  return verifyPremiumAccessInteraction(pact, createClient, {
    state: 'The user has complimentary premium access',
    description: 'a request for the premium access source of a complimentary member',
    premium: true,
    source: 'complimentary',
  })
}

export function verifyNoPremiumAccessInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  return verifyPremiumAccessInteraction(pact, createClient, {
    state: 'The user has no premium access',
    description: 'a request for the premium access source of a member without premium',
    premium: false,
    source: 'none',
  })
}
