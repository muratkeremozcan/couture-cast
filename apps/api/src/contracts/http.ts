// Story 0.9 Task 2 step 7 owner:
// consume the shared HTTP contracts from the API here, so Nest controllers stay thin adapters.
//
// Why this step matters:
// the contract source of truth lives in @couture/api-client. This bridge lets the API use that
// package surface directly instead of redefining request/response shapes inside controller code.
export {
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollQuerySchema,
  eventsPollResponseSchema,
  queueHealthResponseSchema,
} from '@couture/api-client/contracts/http'
