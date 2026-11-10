// Story 6.14 TEA, slice 9: the premium access contract (D6).
//
// The access read is a new strict schema; the subscription response must stay byte-identical
// to `main`, because installed web and mobile builds parse it strictly.
import { execFileSync } from 'node:child_process'
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
const repoRoot = resolve(packageRoot, '../..')

type OpenApiDocument = {
  paths: Record<string, Record<string, Record<string, unknown>>>
  components: { schemas: Record<string, unknown> }
}

function baselineDocument(): OpenApiDocument | null {
  try {
    return JSON.parse(
      execFileSync('git', ['show', 'main:packages/api-client/docs/http.openapi.json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    ) as OpenApiDocument
  } catch {
    return null
  }
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
    const baseline = baselineDocument()
    if (!baseline)
      throw new Error('git show main failed: the frozen-contract proof needs main')
    const current = generateHttpOpenApiDocument() as unknown as OpenApiDocument
    const names = Object.keys(baseline.components.schemas).filter((name) =>
      /^Subscription/.test(name)
    )
    expect(names.length).toBeGreaterThan(0)
    for (const name of names)
      expect({ name, schema: current.components.schemas[name] }).toEqual({
        name,
        schema: baseline.components.schemas[name],
      })
    const statusPath = '/api/v1/commerce/subscription'
    expect(current.paths[statusPath]!.get!.responses).toEqual(
      baseline.paths[statusPath]!.get!.responses
    )
  })
})
