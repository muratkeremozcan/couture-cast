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

/**
 * The public base the API names in upload URLs. Tester report 2026-11-17: production had no
 * PUBLIC_API_URL, the old fallback named http://localhost:3001, and every phone upload failed
 * with "Failed to fetch". Deployed on Vercel without it, the deployment's own public host is
 * named; any other production run without it throws, so the allocation fails loudly with a
 * clear log. Only a non-production run falls back to the local API.
 */
export function publicApiUrl(env: Readonly<NodeJS.ProcessEnv> = process.env): string {
  const configured = env.PUBLIC_API_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const vercelHost =
    env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL)
  if (env.VERCEL_ENV && vercelHost) return `https://${vercelHost}`
  if (env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_API_URL must be set: upload URLs need the API public base')
  }
  return 'http://localhost:3001'
}
