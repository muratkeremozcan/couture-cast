// Learning path Step 14: Author public REST contracts in shared Zod modules.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-14-author-public-rest-contracts-in-shared-zod-modules
import { getOpenApiMetadata } from '@asteasolutions/zod-to-openapi'
import { expect, test } from 'vitest'
import { z } from 'zod'
import * as httpContracts from '../src/contracts/http'

// Story follow-up owner: keep runtime-only contract invariants visible to consumers.
//
// `.refine()` / `.superRefine()` are opaque JavaScript callbacks. `zod-to-openapi`
// cannot introspect them, so the rules they enforce never reach the published
// OpenAPI document or the generated TypeScript types. A consumer building a fixture
// from those types can produce a value the type checker accepts and the schema
// rejects at runtime, which is exactly how the wardrobe onboarding fixtures broke
// apps/mobile during Story 4.4.
//
// Structural constraints (`z.discriminatedUnion`, `min`, `max`, `enum`) do reach the
// spec and need no description. Prefer them. This test only governs the residue that
// cannot be expressed structurally: every such refinement must carry an
// `.openapi({ description })` explaining the rule, so it is published in the spec and
// visible in the generated SDK.

type Child = [string, unknown]

const describedBy = (schema: z.ZodType): string | undefined => {
  const description: unknown = getOpenApiMetadata(schema)?.description
  return typeof description === 'string' ? description : undefined
}

const isRefinement = (schema: z.ZodType): boolean =>
  schema._zod.def.checks?.some((check) => check._zod.def.check === 'custom') ?? false

const isSchema = (value: unknown): value is z.ZodType => value instanceof z.ZodType

function childrenOf(schema: z.ZodType): [string, z.ZodType][] {
  const def = schema._zod.def
  const fields = def as unknown as Record<string, unknown>
  const entries = (values: unknown, label: (index: number) => string): Child[] =>
    Array.isArray(values) ? values.map((value, index) => [label(index), value]) : []
  let children: Child[]

  switch (def.type) {
    case 'object':
      children = Object.entries(fields.shape as Record<string, unknown>).map(
        ([key, value]) => [`.${key}`, value]
      )
      break
    case 'array':
      children = [['[]', fields.element]]
      break
    case 'union':
      children = entries(fields.options, (index) => `|${index}`)
      break
    case 'intersection':
      children = [
        ['&left', fields.left],
        ['&right', fields.right],
      ]
      break
    case 'tuple':
      children = [
        ...entries(fields.items, (index) => `[${index}]`),
        ['[...]', fields.rest],
      ]
      break
    case 'record':
    case 'map':
      children = [
        ['{key}', fields.keyType],
        ['{value}', fields.valueType],
      ]
      break
    case 'set':
      children = [['{value}', fields.valueType]]
      break
    case 'lazy':
      children = [['()', (fields.getter as () => unknown)()]]
      break
    case 'pipe':
      children = [
        ['>in', fields.in],
        ['>out', fields.out],
      ]
      break
    default:
      children = [['', fields.innerType]]
  }

  return children.filter((child): child is [string, z.ZodType] => isSchema(child[1]))
}

function findUndocumentedRefinements(
  roots: [string, unknown][] = Object.entries(httpContracts)
): string[] {
  const undocumented: string[] = []
  const ancestors = new Set<z.ZodType>()
  const walk = (schema: z.ZodType, path: string) => {
    if (ancestors.has(schema)) return
    ancestors.add(schema)

    if (isRefinement(schema) && !describedBy(schema)?.trim()) {
      undocumented.push(path || '<root>')
    }
    for (const [label, child] of childrenOf(schema)) walk(child, `${path}${label}`)

    ancestors.delete(schema)
  }

  for (const [name, exported] of roots) {
    if (isSchema(exported)) walk(exported, name)
  }

  return [...new Set(undocumented)].sort()
}

test('every runtime-only contract invariant is published in the OpenAPI description', () => {
  const undocumented = findUndocumentedRefinements()

  expect(
    undocumented,
    [
      'These schemas use .refine()/.superRefine() without an .openapi({ description }).',
      'zod-to-openapi cannot translate a refinement callback, so the rule is invisible',
      'in the published spec and in the generated types, and consumers only discover it',
      'when parsing fails at runtime.',
      '',
      'Fix by either:',
      '  1. expressing the rule structurally (z.discriminatedUnion, min/max, enum), which',
      '     the generator does translate and Optic does gate; or',
      '  2. adding .openapi({ description: "..." }) that states the invariant, when it',
      '     genuinely cannot be expressed in JSON Schema.',
      '',
      `Undocumented: ${undocumented.join(', ')}`,
    ].join('\n')
  ).toEqual([])
})

test('the walker actually detects an undocumented refinement', () => {
  // Guards against the check silently passing because the walker stopped traversing.
  const undocumented = z.object({
    nested: z.object({ value: z.string().refine(() => true) }),
  })

  const seen: string[] = []
  const walk = (schema: z.ZodTypeAny, path: string) => {
    if (isRefinement(schema) && !describedBy(schema)) seen.push(path)
    for (const [label, child] of childrenOf(schema)) walk(child, `${path}${label}`)
  }
  walk(undocumented, 'fixture')

  expect(seen).toEqual(['fixture.nested.value'])
})

test('a shared refinement is still reported when only one path documents it', () => {
  // Zod 4 keeps chained checks on the cloned schema. The property still uses
  // the original schema, which needs its own description.
  const shared = z.object({ value: z.string() }).refine(() => true)
  const documented = shared
    .refine(() => true)
    .openapi({ description: 'covers the chain' })
  const viaProperty = z.object({ nested: shared })

  expect(
    findUndocumentedRefinements([
      ['documented', documented],
      ['viaProperty', viaProperty],
    ])
  ).toEqual(['viaProperty.nested'])

  // Order must not matter: the uncovered path is reported either way.
  expect(
    findUndocumentedRefinements([
      ['viaProperty', viaProperty],
      ['documented', documented],
    ])
  ).toEqual(['viaProperty.nested'])
})
