/**
 * Story 6.5: how long one community read may spend authorizing before it answers 503.
 * Kept free of imports so test harnesses that hold community sources can bound their
 * holds by it without loading the API.
 */
export const COMMUNITY_AUTHORIZATION_BUDGET_MS = 1950
