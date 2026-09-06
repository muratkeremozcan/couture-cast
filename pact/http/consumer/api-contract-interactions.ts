// Step 22 step 5 owner: check Accept-Language header propagation in Pact consumer tests in pact/http/consumer/api-contract-interactions.ts

/**
 * The consumer interaction registry.
 *
 * This file held every interaction in the repository and reached 3982 lines,
 * because each story appended its own to the bottom rather than anywhere a
 * reader would look for it. It is a barrel now: the interactions live in
 * `interactions/`, one module per domain, and this re-exports them, so
 * `web-api-client.pacttest.ts` and `mobile-api-client.pacttest.ts` import
 * exactly what they imported before.
 *
 * Nothing about the generated pacts changes, and that is checkable rather than
 * asserted: `npm run test:pact:consumer` runs the suite three times and compares
 * the written pact files, so a re-export that dropped an interaction shows up as
 * a changed count instead of as a silent hole in coverage.
 *
 * Where a new interaction goes: the module for its domain, or a new module
 * beside them if a story opens a surface none of these cover. Appending it here
 * is what produced the original file.
 */

export * from './interactions/shared'
export * from './interactions/health-events'
export * from './interactions/ritual-comfort'
export * from './interactions/wardrobe-tags'
export * from './interactions/wardrobe-capsules'
export * from './interactions/wardrobe-fixtures'
export * from './interactions/wardrobe-onboarding'
export * from './interactions/wardrobe-silhouette'
export * from './interactions/commerce-affiliate'
export * from './interactions/commerce-subscription'
export * from './interactions/commerce-premium-theme'
export * from './interactions/commerce-palette-advisor'
export * from './interactions/planner'
export * from './interactions/community'
