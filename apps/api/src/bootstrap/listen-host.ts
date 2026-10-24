/**
 * The interface `main.ts` binds the HTTP server to, or undefined for Nest's default
 * (every interface), which deployed and container runs rely on.
 *
 * `API_LISTEN_HOST` narrows it. The real-session E2E harness
 * (`scripts/e2e-real-session/run.mjs`) sets `127.0.0.1`: its API accepts the
 * deterministic test-only webhook secrets of `TEST_ENV=local`, and a laptop on a
 * shared network must not expose that to the LAN for the length of a run.
 */
export function resolveListenHost(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const host = env.API_LISTEN_HOST?.trim()
  return host ? host : undefined
}
