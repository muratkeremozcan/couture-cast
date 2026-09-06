// Step 13 step 3 owner: searchable owner anchor
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { registerAlertsContracts } from './alerts'
import { registerAuthContracts } from './auth'
import { registerCommonHttpSchemas } from './common'
import { registerEventsContracts } from './events'
import { registerGuardianContracts } from './guardian'
import { registerHealthContracts } from './health'
import { registerLocationsContracts } from './locations'
import { registerModerationContracts } from './moderation'
import { registerUserContracts } from './user'
import { registerWeatherContracts } from './weather'
import { registerRitualContracts } from './ritual'
import { registerComfortContracts } from './comfort'
import { registerWardrobeContracts } from './wardrobe'
import { registerCommerceContracts } from './commerce'
import { registerSubscriptionContracts } from './subscription'
import { registerPremiumThemeContracts } from './premium-theme'
import { registerPaletteAdvisorContracts } from './palette-advisor'
import { registerPlannerContracts } from './planner'
import { registerCommunityContracts } from './community'

export const HTTP_OPENAPI_OUTPUT_FILENAME = 'http.openapi.json'

/**
 * zod-to-openapi renders `enum.nullable()` as
 * `{"type": ["string", "null"], "enum": [...values]}`, dropping the `null`
 * member and leaving a schema that rejects the value its own type allows. This
 * pass puts it back.
 *
 * KNOWN DEFECT, deliberately not corrected here. The append is in place, and the
 * array being appended to is the ZodEnum's own `_def.values`, which
 * zod-to-openapi hands out by reference. So one nullable publication of an enum
 * leaks `null` into every other publication of that same enum, non-nullable ones
 * included. Nine nodes in the published spec carry that leak today, each an
 * invalid `{"type": "string", "enum": [..., null]}`: `ScenarioOutfit`,
 * `RitualResponse` and `ShopThisLook`'s `garmentCategory`,
 * `SuggestGarmentTagsResponse`'s three `suggestions.*.value` nodes,
 * `UpdateGarmentTagsInput`'s `category` and `comfortRange`, and the
 * `comfortRange` query parameter of
 * `GET /api/v1/wardrobe/{ownerUserId}/capsules`. None of those properties has
 * ever accepted `null` at the boundary.
 *
 * The correction is one line, `schema.enum = [...enumValues, null]` in place of
 * `schema.enum.push(null)`, and it cannot ship through the pull-request gate as
 * things stand. It rewrites those nine nodes, and `optic diff` reads three of
 * them as breaking enum removals: the capsules query parameter under
 * `prevent query parameters enum breaking changes`, and
 * `UpdateGarmentTagsInput.category` / `.comfortRange` under
 * `request and response property enums`. Optic's documented escape,
 * `x-optic-exemptions`, closes the first and cannot close the other two:
 * `createRequestPropertyResult` in `@useoptic/rulesets-base` 1.0.9 builds its
 * result without copying the `exempted` flag, so request-body property
 * exemptions are computed and then discarded. Verified by instrumenting
 * `isExempted`, which returns `true` while the emitted result carries
 * `exempted: undefined`. 1.0.9 is the last published Optic release, so no
 * upgrade fixes it.
 *
 * Landing the correction therefore needs an owner decision this story cannot
 * make for it: patch or vendor `@useoptic/rulesets-base` so property exemptions
 * survive, or merge the corrected baseline past the gate once. Until then this
 * pass stays byte-compatible with the published spec, and new contracts avoid
 * the hazard by publishing a finished `enum` array of their own. Copy
 * `nullablePremiumThemeKeySchema` in `./premium-theme`.
 */
function preserveNullableEnumValues(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) preserveNullableEnumValues(item)
    return
  }
  if (!value || typeof value !== 'object') return

  const schema = value as Record<string, unknown>
  if (
    Array.isArray(schema.type) &&
    schema.type.includes('null') &&
    Array.isArray(schema.enum) &&
    !schema.enum.includes(null)
  ) {
    schema.enum.push(null)
  }
  for (const child of Object.values(schema)) preserveNullableEnumValues(child)
}

// Story 0.9 Task 2 step 4 owner:
// compose every contract slice into one canonical OpenAPI registry and document here.
//
// Why this step matters:
// this is the bridge from many local Zod schemas to one published API contract file that SDKs,
// CI checks, and documentation tools can all consume consistently.
extendZodWithOpenApi(z)

export function createHttpOpenApiRegistry() {
  const registry = new OpenAPIRegistry()

  const commonSchemas = registerCommonHttpSchemas(registry)
  registerAlertsContracts(registry, commonSchemas)
  registerAuthContracts(registry, commonSchemas)
  registerHealthContracts(registry)
  registerEventsContracts(registry, commonSchemas)
  registerGuardianContracts(registry, commonSchemas)
  registerLocationsContracts(registry, commonSchemas)
  registerModerationContracts(registry, commonSchemas)
  registerUserContracts(registry, commonSchemas)
  registerWeatherContracts(registry, commonSchemas)
  registerRitualContracts(registry, commonSchemas)
  registerComfortContracts(registry, commonSchemas)
  registerWardrobeContracts(registry, commonSchemas)
  registerCommerceContracts(registry, commonSchemas)
  registerSubscriptionContracts(registry, commonSchemas)
  registerPremiumThemeContracts(registry, commonSchemas)
  registerPaletteAdvisorContracts(registry, commonSchemas)
  registerPlannerContracts(registry, commonSchemas)
  registerCommunityContracts(registry, commonSchemas)

  return registry
}

export function generateHttpOpenApiDocument() {
  const registry = createHttpOpenApiRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CoutureCast HTTP API',
      // 1.0.0 marks the point where the published contract is treated as stable
      // and gated accordingly. The major bump is also what lets Optic accept the
      // one-time response-schema narrowing in this change: `breaking-changes`
      // defaults to `skip_when_major_version_changes`, which is the mechanism
      // intended for exactly this, rather than an operation-level exemption.
      // Story 5.1 bumps the minor: the published contract gained four commerce
      // operations and one additive field on the ritual response. Nothing here
      // is breaking (`scenarioOutfitSchema` is not `.strict()`, so an added key
      // is compatible), but a consumer reading the spec should be able to see
      // that the surface grew without diffing it.
      // Story 5.2 bumps the minor again: six additive subscription operations
      // (status, refresh, checkout-session, portal-session, two webhooks) and
      // no changes to existing operations.
      // Story 5.3 bumps the minor again: two additive premium-theme operations
      // (read and set the palette) under a new tag, and no changes to existing
      // operations.
      // Story 5.4 bumps the minor again: eight additive palette-advisor
      // operations under a new tag, one additive `palette_advisor` member on
      // `affiliateSurfaceSchema`, and no changes to existing operations.
      // Story 5.5 bumps the minor again: two additive planner operations
      // (GET the seven-day window, POST a per-day reshuffle) under a new tag,
      // and no changes to existing operations.
      // Story 6.1 bumps the minor again: nine additive community operations
      // (feed read, single-post read, upload allocate, publish, report, card
      // open, withdraw, challenge create, challenge update) under a new tag,
      // and no changes to existing operations.
      version: '1.6.0',
      description: 'Canonical HTTP contracts shared across API, web, mobile, and tests.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development server',
      },
    ],
  })
  preserveNullableEnumValues(document)
  return document
}
