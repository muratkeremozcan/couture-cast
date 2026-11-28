// Step 13 step 3 owner: searchable owner anchor
// Story 1.1 Task 5 step 2 owner: register `GET /api/v1/weather/{locationKey}` in `packages/api-client/src/contracts/http/openapi.ts`
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { registerShareCardsContracts } from './share-cards'
import { registerAlertsContracts } from './alerts'
import { registerAuthContracts } from './auth'
import { registerCommonHttpSchemas } from './common'
import { registerEventsContracts } from './events'
import { registerGuardianContracts } from './guardian'
import { registerHealthContracts } from './health'
import { registerLocationsContracts } from './locations'
import { registerModerationContracts } from './moderation'
import { registerModerationDecisionContracts } from './moderation-decisions'
import { registerModerationQueueContracts } from './moderation-queue'
import { registerModerationSlaContracts } from './moderation-sla'
import { registerModerationHistoryContracts } from './moderation-history'
import { registerUserContracts } from './user'
import { registerWeatherContracts } from './weather'
import { registerRitualContracts } from './ritual'
import { registerComfortContracts } from './comfort'
import { registerStyleProfileContracts } from './style-profile'
import { registerLookIdeasContract } from './look-ideas'
import { registerWardrobeContracts } from './wardrobe'
import { registerSavedLooksContracts } from './saved-looks'
import { registerCommerceContracts } from './commerce'
import { registerSubscriptionContracts } from './subscription'
import { registerPremiumThemeContracts } from './premium-theme'
import { registerPremiumAccessContracts } from './premium-access'
import { registerPaletteAdvisorContracts } from './palette-advisor'
import { registerPlannerContracts } from './planner'
import { registerCommunitySyncContracts } from './community-sync'
import { registerCommunityContracts } from './community'

export const HTTP_OPENAPI_OUTPUT_FILENAME = 'http.openapi.json'

/**
 * OpenAPI 3.1 applies both type and enum constraints. Include null in the enum
 * whenever the generated schema allows null in its type.
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
    schema.enum = [...(schema.enum as unknown[]), null]
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
  registerStyleProfileContracts(registry, commonSchemas)
  registerLookIdeasContract(registry, commonSchemas)
  registerWardrobeContracts(registry, commonSchemas)
  registerSavedLooksContracts(registry, commonSchemas)
  registerCommerceContracts(registry, commonSchemas)
  registerSubscriptionContracts(registry, commonSchemas)
  registerPremiumThemeContracts(registry, commonSchemas)
  registerPremiumAccessContracts(registry, commonSchemas)
  registerPaletteAdvisorContracts(registry, commonSchemas)
  registerPlannerContracts(registry, commonSchemas)
  registerCommunityContracts(registry, commonSchemas)
  registerCommunitySyncContracts(registry, commonSchemas)
  registerModerationQueueContracts(registry)
  registerModerationDecisionContracts(registry)
  registerModerationSlaContracts(registry)
  registerModerationHistoryContracts(registry)
  registerShareCardsContracts(registry)

  return registry
}

/**
 * Story 6.11: `z.union` publishes `anyOf`, and the TypeScript generator flattens `anyOf` into one
 * interface that requires every member's fields, which neither real 403 body satisfies. A body is
 * exactly one of these members, so `oneOf` is the true shape, and it generates a union type.
 */
function publishBannedRefusalsAsOneOf(document: {
  paths?: Record<string, unknown>
}): void {
  for (const path of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(path as Record<string, unknown>)) {
      const forbidden = (operation as { responses?: Record<string, unknown> } | null)
        ?.responses?.['403'] as
        | { content?: Record<string, { schema?: Record<string, unknown> }> }
        | undefined
      const schema = forbidden?.content?.['application/json']?.schema
      if (!schema?.anyOf) continue
      schema.oneOf = schema.anyOf
      delete schema.anyOf
    }
  }
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
      // Stories 6.3 to 6.6 bump the minor once more; none of them shipped its
      // own bump, so this entry records all four. 6.3 adds the reaction PUT and
      // reaction projections negotiated by the `x-couture-reactions` request
      // header. 6.4 adds six comment operations (list, replies, create, delete,
      // report, submission status). 6.5 adds the community events stream, the
      // targets resolve read, notification preferences read and update, and
      // push token register, list and delete. 6.6 adds the City Spotlight read
      // and an optional spotlight branch (`surface`, `rank`, `level`) on the
      // card-open body, which keeps a body without `surface` valid unchanged.
      // No existing operation narrows.
      // Story 6.14 bumps the minor: one additive premium access read, and one more
      // documented 409 message on checkout. No existing operation narrows.
      // Story CC-7.2 bumps the minor: four additive account-backed saved-looks
      // operations under /api/v1/wardrobe/saved-looks. No existing operation narrows.
      // Story CC-7.5 bumps the minor: an optional x-couture-garment-color header on the
      // garment list and tag update adds colorFamily for clients that send it. Responses
      // without the header keep their strict legacy shape. The tag update also takes an
      // optional `expected` and documents one more 409 message, GARMENT_TAGS_CHANGED.
      // Story CC-7.6 bumps the minor: one additive garment usage read, and the existing
      // garment DELETE (204) is now published. No existing operation narrows.
      // CC-7.19 adds independently negotiated garment subtypes and optional update fields.
      // CC-7.20 adds the three owner-scoped style profile operations.
      version: '1.13.0',
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
  publishBannedRefusalsAsOneOf(document)
  return document
}
