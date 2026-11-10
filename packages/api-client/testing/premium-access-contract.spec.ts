// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA, slice 9: the premium access contract (D6).
//
// The access read is a new strict schema; the subscription response must stay byte-identical
// to `main` before this story, because installed web and mobile builds parse it strictly.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  premiumAccessResponseSchema,
  premiumAccessSchema,
} from '../src/contracts/http/premium-access'
import { generateHttpOpenApiDocument } from '../src/contracts/http/openapi'
import { SubscriptionApi } from '../src/generated/apis/SubscriptionApi'

const packageRoot = resolve(__dirname, '..')

type OpenApiDocument = {
  paths: Record<string, Record<string, Record<string, unknown>>>
  components: { schemas: Record<string, unknown> }
}

/**
 * The subscription contract as `main` published it before this story (OpenAPI 1.7.0), checked
 * in so the proof needs no git history: CI checks out one commit with no `main` ref.
 */
const baseline = JSON.parse(
  readFileSync(resolve(__dirname, 'subscription-contract-1.7.0.baseline.json'), 'utf8')
) as {
  schemas: Record<string, unknown>
  statusResponses: Record<string, unknown>
}

describe('premium access contract', () => {
  it('U-C-STRICT: accepts the three consistent answers', () => {
    for (const data of [
      { premium: false, source: 'none' },
      { premium: true, source: 'subscription' },
      { premium: true, source: 'complimentary' },
    ])
      expect(premiumAccessResponseSchema.parse({ data })).toEqual({ data })
  })

  it('U-C-STRICT: rejects an extra key, a missing key and an unknown source', () => {
    for (const data of [
      { premium: true, source: 'complimentary', grantId: 'x' },
      { premium: true },
      { source: 'none' },
      { premium: true, source: 'promotional' },
      { premium: 'true', source: 'subscription' },
    ])
      expect(premiumAccessSchema.safeParse(data).success).toBe(false)
  })

  it('U-C-STRICT: rejects a premium flag that disagrees with its source', () => {
    for (const data of [
      { premium: true, source: 'none' },
      { premium: false, source: 'subscription' },
      { premium: false, source: 'complimentary' },
    ])
      expect({ data, success: premiumAccessSchema.safeParse(data).success }).toEqual({
        data,
        success: false,
      })
  })

  it('U-C-OPENAPI: the route is registered bearer-only with the access response, and the committed document matches the generator', () => {
    const generated = generateHttpOpenApiDocument() as unknown as OpenApiDocument
    const committed = JSON.parse(
      readFileSync(resolve(packageRoot, 'docs/http.openapi.json'), 'utf8')
    ) as OpenApiDocument
    const route = generated.paths['/api/v1/commerce/premium/access']
    expect(Object.keys(route ?? {})).toEqual(['get'])
    expect(route!.get!.security).toEqual([{ bearerAuth: [] }])
    expect(Object.keys(route!.get!.responses as object).sort()).toEqual([
      '200',
      '401',
      '500',
    ])
    expect(JSON.stringify(route!.get!.responses)).toContain(
      '#/components/schemas/PremiumAccessResponse'
    )
    expect(committed.paths['/api/v1/commerce/premium/access']).toEqual(route)
    expect(typeof SubscriptionApi.prototype.apiV1CommercePremiumAccessGet).toBe(
      'function'
    )
  })

  it('U-C-SUBSCRIPTION-FROZEN: the subscription response schemas are unchanged from main', () => {
    const current = generateHttpOpenApiDocument() as unknown as OpenApiDocument
    const names = Object.keys(baseline.schemas)
    expect(names.sort()).toEqual([
      'Subscription',
      'SubscriptionPlan',
      'SubscriptionResponse',
      'SubscriptionStatus',
    ])
    for (const name of names)
      expect({ name, schema: current.components.schemas[name] }).toEqual({
        name,
        schema: baseline.schemas[name],
      })
    expect(current.paths['/api/v1/commerce/subscription']!.get!.responses).toEqual(
      baseline.statusResponses
    )
  })
})
