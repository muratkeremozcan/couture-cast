import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ScriptTarget,
  createSourceFile,
  forEachChild,
  isClassDeclaration,
  isIdentifier,
  isMethodDeclaration,
  type Node,
} from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Story 6.14 D5 (G-BILLING-UNTOUCHED): paid entitlement keeps one writer, the RevenueCat
 * webhook plus reconciliation, and no billing path reads or writes a complimentary grant.
 * A grant that leaked into a ledger path could be expired by the sweep or billed, so the
 * billing files and the two ledger methods must never name the grant model or its seam.
 */
const commerce = resolve(__dirname)
const forbidden = [
  /complimentaryAccessGrant/,
  /ComplimentaryAccessGrant/,
  /ComplimentaryAccessService/,
  /complimentary-access/,
]

const billingFiles = [
  'billing-webhook.service.ts',
  'billing-reconciliation.service.ts',
  'subscription.service.ts',
  'revenuecat-client.ts',
  'stripe-client.ts',
]

function methodBody(file: string, className: string, method: string): string {
  const source = createSourceFile(
    file,
    readFileSync(resolve(commerce, file), 'utf8'),
    ScriptTarget.Latest,
    true
  )
  let body: string | undefined
  const visit = (node: Node) => {
    if (isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (
          isMethodDeclaration(member) &&
          isIdentifier(member.name) &&
          member.name.text === method &&
          member.body
        )
          body = member.body.getText(source)
      }
    }
    forEachChild(node, visit)
  }
  visit(source)
  if (body === undefined) throw new Error(`${className}.${method} not found in ${file}`)
  return body
}

describe('G-BILLING-UNTOUCHED: billing never touches complimentary access', () => {
  it.each(billingFiles)('%s never names the grant model or its seam', (file) => {
    const text = readFileSync(resolve(commerce, file), 'utf8')
    for (const pattern of forbidden) expect(text).not.toMatch(pattern)
  })

  it.each(['applyLedgerEvent', 'applyLedgerSnapshot'])(
    'PremiumEntitlementService.%s never names the grant or asks the seam',
    (method) => {
      const body = methodBody(
        'premium-entitlement.service.ts',
        'PremiumEntitlementService',
        method
      )
      expect(body.length).toBeGreaterThan(0)
      for (const pattern of [
        ...forbidden,
        /isActive/,
        /\.complimentary\b/,
        /premiumAccessSource/,
      ])
        expect(body).not.toMatch(pattern)
    }
  )

  it('the operator that grants and revokes never names a billing model (seeded defect S-10)', () => {
    const text = readFileSync(
      resolve(commerce, 'complimentary-access-operator.service.ts'),
      'utf8'
    )
    for (const pattern of [
      /premiumEntitlement/i,
      /billingCustomer/i,
      /billingEvent/i,
      /RevenueCat/i,
      /Stripe/i,
    ])
      expect({ pattern: String(pattern), found: pattern.test(text) }).toEqual({
        pattern: String(pattern),
        found: false,
      })
  })
})
