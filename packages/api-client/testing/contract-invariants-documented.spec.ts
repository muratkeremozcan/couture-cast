// Learning path Step 14: Author public REST contracts in shared Zod modules.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-14-author-public-rest-contracts-in-shared-zod-modules
import { expect, test } from 'vitest'
import { z } from 'zod'
import * as httpContracts from '../src/contracts/http'

// Story follow-up owner: keep runtime-only contract invariants visible to consumers.
//
// Why this test exists:
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

type ZodDef = Record<string, unknown>

const defOf = (schema: z.ZodTypeAny): ZodDef => schema._def as unknown as ZodDef

const describedBy = (schema: z.ZodTypeAny): string | undefined => {
  const openapi = defOf(schema).openapi as
    | { metadata?: { description?: string } }
    | undefined
  return openapi?.metadata?.description
}

const isRefinement = (schema: z.ZodTypeAny): boolean => {
  const def = defOf(schema)
  if (def.typeName !== z.ZodFirstPartyTypeKind.ZodEffects) return false
  const effect = def.effect as { type?: string } | undefined
  return effect?.type === 'refinement'
}

type Child = [string, unknown]

/**
 * How to reach the child schemas of each zod node kind. Node kinds absent from
 * this table fall back to `innerType`, which covers every simple wrapper
 * (optional, nullable, default, catch, readonly, branded, promise).
 */
const CHILD_ACCESSORS: Partial<Record<string, (def: ZodDef) => Child[]>> = {
  [z.ZodFirstPartyTypeKind.ZodObject]: (def) =>
    Object.entries((def.shape as () => Record<string, z.ZodTypeAny>)()).map(
      ([key, value]) => [`.${key}`, value]
    ),
  [z.ZodFirstPartyTypeKind.ZodArray]: (def) => [['[]', def.type]],
  [z.ZodFirstPartyTypeKind.ZodEffects]: (def) => [['', def.schema]],
  [z.ZodFirstPartyTypeKind.ZodUnion]: (def) =>
    [...((def.options ?? []) as Iterable<z.ZodTypeAny>)].map((option, index) => [
      `|${index}`,
      option,
    ]),
  [z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion]: (def) =>
    [...((def.options ?? []) as Iterable<z.ZodTypeAny>)].map((option, index) => [
      `|${index}`,
      option,
    ]),
  [z.ZodFirstPartyTypeKind.ZodIntersection]: (def) => [
    ['&left', def.left],
    ['&right', def.right],
  ],
  [z.ZodFirstPartyTypeKind.ZodTuple]: (def) => [
    ...((def.items ?? []) as z.ZodTypeAny[]).map(
      (item, index): Child => [`[${index}]`, item]
    ),
    ['[...]', def.rest],
  ],
  [z.ZodFirstPartyTypeKind.ZodRecord]: (def) => [
    ['{key}', def.keyType],
    ['{value}', def.valueType],
  ],
  [z.ZodFirstPartyTypeKind.ZodMap]: (def) => [
    ['{key}', def.keyType],
    ['{value}', def.valueType],
  ],
  [z.ZodFirstPartyTypeKind.ZodSet]: (def) => [['{value}', def.valueType]],
  [z.ZodFirstPartyTypeKind.ZodLazy]: (def) => [
    ['()', (def.getter as () => z.ZodTypeAny)()],
  ],
  [z.ZodFirstPartyTypeKind.ZodPipeline]: (def) => [
    ['>in', def.in],
    ['>out', def.out],
  ],
}

const isSchema = (value: unknown): value is z.ZodTypeAny =>
  Boolean(value) && typeof value === 'object' && '_def' in (value as object)

/**
 * Collects the child schemas of any zod node. Unknown node types simply yield
 * nothing, which keeps the walker from throwing as the contract surface grows.
 */
function childrenOf(schema: z.ZodTypeAny): [string, z.ZodTypeAny][] {
  const def = defOf(schema)
  const accessor =
    CHILD_ACCESSORS[def.typeName as string] ??
    ((wrapper: ZodDef): Child[] => [['', wrapper.innerType]])

  return accessor(def).filter((child): child is [string, z.ZodTypeAny] =>
    isSchema(child[1])
  )
}

function findUndocumentedRefinements(
  roots: [string, unknown][] = Object.entries(httpContracts)
): string[] {
  const undocumented: string[] = []

  /**
   * Keyed by `(schema, covered)` rather than by schema alone. A schema shared
   * between a documented `.refine().refine().openapi({...})` chain and a plain
   * property reference is reachable in both states, and collapsing them would
   * let the covered visit mark the node seen and silently suppress the
   * uncovered one.
   */
  const seen = new WeakMap<object, Set<boolean>>()
  const alreadyWalked = (schema: z.ZodTypeAny, covered: boolean): boolean => {
    const states = seen.get(schema)
    if (states?.has(covered)) return true
    if (states) states.add(covered)
    else seen.set(schema, new Set([covered]))
    return false
  }

  /**
   * `covered` propagates only through consecutive ZodEffects nodes, so a single
   * description covers a chain like `.refine().refine().openapi({...})` while a
   * refinement nested inside an object property still has to document itself.
   */
  const walk = (schema: z.ZodTypeAny, path: string, covered: boolean) => {
    if (alreadyWalked(schema, covered)) return

    let coveredForChildren = false

    if (isRefinement(schema)) {
      const description = describedBy(schema)
      if (description && description.trim().length > 0) {
        coveredForChildren = true
      } else if (!covered) {
        undocumented.push(path || '<root>')
      } else {
        coveredForChildren = true
      }
    }

    for (const [label, child] of childrenOf(schema)) {
      const childIsEffectsChain =
        defOf(schema).typeName === z.ZodFirstPartyTypeKind.ZodEffects
      walk(child, `${path}${label}`, childIsEffectsChain ? coveredForChildren : false)
    }
  }

  for (const [name, exported] of roots) {
    if (!isSchema(exported)) continue
    walk(exported, name, false)
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
  // `shared` is undocumented. `documented` wraps it in a described chain, which
  // reaches it with covered=true; `viaProperty` reaches the same node with
  // covered=false. Keying traversal state on the schema alone would let the
  // first visit suppress the second and hide a genuinely undocumented rule.
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
