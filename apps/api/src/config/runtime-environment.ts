function normalizedTestEnv(env: Readonly<NodeJS.ProcessEnv>): string {
  return (env.TEST_ENV ?? '').trim().toLowerCase()
}

export function allowsTestOnlySecrets(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env.NODE_ENV === 'test' || normalizedTestEnv(env) === 'local'
}

/**
 * Story 6.15 D15: whether a RevenueCat Test Store purchase may enter the entitlement ledger as
 * `test_store`. Only an explicit `TEST_ENV` of `local` or `preview` opens it. `NODE_ENV=test`
 * does not, and unset or any other value (staging, production) keeps the production partition,
 * where a store we do not sell is record-only and the REST pull refuses it (R3-01).
 */
export function appliesRevenueCatTestStore(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  const testEnv = normalizedTestEnv(env)
  return testEnv === 'local' || testEnv === 'preview'
}
