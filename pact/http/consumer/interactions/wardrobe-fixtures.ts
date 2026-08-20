import type {
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
  WardrobeOnboardingStatus,
  WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import { equal, isoTimestamp, like, nullValue, string } from './shared'
import { CAPSULE_OWNER_ID } from './wardrobe-capsules'

/* ------------------------------------------------------------------------- *
 * Story 4.4 wardrobe onboarding and silhouette setup
 *
 * Pact covers request and response shapes, status codes, headers, and error
 * envelopes for the onboarding state machine and the silhouette/My Form
 * pipeline. The forward-only state machine, revision/If-Match races, RLS,
 * and the moderation pipeline itself stay in the API and PostgreSQL
 * integration suites. One `addInteraction()`/`executeTest()` cycle per case.
 *
 * Decision 11 gives guardians no dedicated HTTP route for onboarding or
 * silhouette (both are self-scoped to `auth.userId`, unlike capsules'
 * `:ownerUserId` path): a guardian's read/write access is proven at the RLS
 * layer in `packages/db/test/rls-policies.spec.ts`, not here. "Guardian
 * access" at this HTTP layer is the `WardrobeUploadGuard` consent gate
 * decision 7 requires on every silhouette route, exercised below for both a
 * read and a write by a teen actor without active guardian consent.
 *
 * The My Form bytes-PUT endpoint
 * (`PUT /api/v1/wardrobe/silhouette/my-form/uploads/{uploadSessionId}`) has
 * no Pact interaction here, matching the existing precedent: the sibling
 * garment bytes-PUT endpoint (`PUT /api/v1/wardrobe/uploads/{uploadSessionId}`)
 * has never had one either, since Web/Mobile upload raw bytes with the
 * shared `uploadGarmentBytes()` fetch helper straight to the signed
 * `uploadUrl`, not through a generated-SDK call this file can pin cleanly.
 * ------------------------------------------------------------------------- */

export const ONBOARDING_OWNER_ID = CAPSULE_OWNER_ID
export const SILHOUETTE_TEEN_ID = 'teen-1'
export const SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY = '6eae27b8-8335-476e-a3bf-371e9fa5fd26'
export const SILHOUETTE_COMMIT_IDEMPOTENCY_KEY = '760490a0-5049-4cdd-afcf-ac8e7ba0b436'
export const SILHOUETTE_UPLOAD_SESSION_ID = '85b4dde2-3df2-4e81-8c18-d51ae3408ca0'
export const SILHOUETTE_SHA256 =
  'ba9d325931fa708929de6fdc7d90728bf50bffbc1cbfcaa7e2e2275c175dc0b3'

export const ONBOARDING_STARTED_AT = '2026-08-09T09:00:00.000Z'
const SILHOUETTE_UPDATED_AT = '2026-08-09T09:05:00.000Z'
export const SILHOUETTE_COMMITTED_AT = '2026-08-09T09:10:00.000Z'
export const SILHOUETTE_UPLOAD_EXPIRY = '2026-08-09T09:15:00.000Z'
export const SILHOUETTE_IMAGE_EXPIRY = '2026-08-09T09:25:00.000Z'

/** Mirrors Task 3's documented virtual-default ETag shape: `"onboarding:<userId>:<revision>"`. */
export const onboardingETagFor = (revision: number) =>
  `"onboarding:${ONBOARDING_OWNER_ID}:${revision}"`
/** Silhouette is a one-row-per-user singleton, so its ETag follows the same user-scoped shape. */
export const silhouetteETagFor = (revision: number) =>
  `"silhouette:${ONBOARDING_OWNER_ID}:${revision}"`

export function onboardingStateBody(
  revision: number,
  fields: {
    status: WardrobeOnboardingStatus
    currentStep: WardrobeOnboardingStep
    usedStarterWardrobe: boolean
    garmentsCapturedCount: number
    startedAt: string | null
    completedAt: string | null
  }
) {
  return {
    status: string(fields.status),
    currentStep: string(fields.currentStep),
    usedStarterWardrobe: like(fields.usedStarterWardrobe),
    garmentsCapturedCount: like(fields.garmentsCapturedCount),
    startedAt: fields.startedAt === null ? nullValue() : isoTimestamp(fields.startedAt),
    completedAt:
      fields.completedAt === null ? nullValue() : isoTimestamp(fields.completedAt),
    revision: like(revision),
  }
}

type SilhouetteMyFormFields = {
  status: SilhouettePhotoStatus
  failureReason: SilhouettePhotoFailureReason | null
  committedAt: string | null
  imageAccess: null | { url: string; expiresAt: string }
}

export function silhouetteProfileBody(
  revision: number,
  fields: {
    mode: SilhouetteMode
    heightSlider: number | null
    buildSlider: number | null
    myForm: null | SilhouetteMyFormFields
  }
) {
  return {
    mode: string(fields.mode),
    heightSlider: fields.heightSlider === null ? nullValue() : like(fields.heightSlider),
    buildSlider: fields.buildSlider === null ? nullValue() : like(fields.buildSlider),
    myForm:
      fields.myForm === null
        ? nullValue()
        : {
            status: string(fields.myForm.status),
            // `equal`, not `string`: this field distinguishes one documented
            // failure reason from another (`verifyMyFormFailureInteraction`
            // drives 4 interactions off this same helper, one per reason), so
            // a type-only matcher would let a provider bug that returns the
            // wrong reason for a given named state still pass verification.
            failureReason:
              fields.myForm.failureReason === null
                ? nullValue()
                : equal(fields.myForm.failureReason),
            committedAt:
              fields.myForm.committedAt === null
                ? nullValue()
                : isoTimestamp(fields.myForm.committedAt),
            imageAccess:
              fields.myForm.imageAccess === null
                ? nullValue()
                : {
                    url: string(fields.myForm.imageAccess.url),
                    expiresAt: isoTimestamp(fields.myForm.imageAccess.expiresAt),
                  },
          },
    revision: like(revision),
    updatedAt: isoTimestamp(SILHOUETTE_UPDATED_AT),
  }
}
