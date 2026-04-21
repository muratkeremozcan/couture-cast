// Story 0.9 Task 2 step 7 owner:
// consume the shared HTTP contracts from the API here, so Nest controllers stay thin adapters.
//
// Why this step matters:
// the contract source of truth lives in @couture/api-client. This bridge lets the API use that
// package surface directly instead of redefining request/response shapes inside controller code.
export {
  type ConsentLevel,
  type GuardianConsentInput,
  type GuardianConsentRevokeInput,
  type GuardianConsentRevokeResponse,
  type GuardianInvitationAcceptInput,
  type GuardianInvitationAcceptResponse,
  type GuardianInvitationInput,
  type GuardianInvitationResponse,
  type SignupInput,
  type SignupResponse,
  consentLevelSchema,
  guardianConsentInputSchema,
  guardianConsentRevokeInputSchema,
  guardianConsentRevokeResponseSchema,
  guardianConsentResponseSchema,
  guardianInvitationAcceptInputSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationInputSchema,
  guardianInvitationResponseSchema,
  signupInputSchema,
  signupResponseSchema,
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollQuerySchema,
  eventsPollResponseSchema,
  type ModerationActionInput,
  moderationActionInputSchema,
  moderationActionResponseSchema,
  queueHealthResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
