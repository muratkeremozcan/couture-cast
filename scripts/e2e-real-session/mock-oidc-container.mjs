/**
 * Story 6.17 D10, TEA-13: runs `mock-oidc.mjs` as a container on the local Supabase network.
 *
 * GoTrue calls the provider's token and userinfo endpoints from inside its own container, so the
 * mock must be reachable there by the name `supabase/config.toml` gives it
 * (`http://couturecast-mock-oidc:8080/realms/cc`). The browser reaches the same mock through the
 * published `127.0.0.1` port; the Playwright stand-in helper rewrites the host for it.
 *
 * The container runs the repository's own script read-only with the stock Node image the stack
 * already pulls; it holds no state beyond the run and is removed on release.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const MOCK_OIDC_CONTAINER = 'couturecast-mock-oidc'
export const MOCK_OIDC_INTERNAL_URL = `http://${MOCK_OIDC_CONTAINER}:8080`
export const MOCK_OIDC_PORT = 53052
export const MOCK_OIDC_PUBLIC_URL = `http://127.0.0.1:${MOCK_OIDC_PORT}`
const IMAGE = 'node:24-slim'
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-oidc.mjs')

/** `supabase_network_<project_id>`, the network `supabase start` creates. */
export function supabaseNetwork(projectId = 'couture-cast') {
  return `supabase_network_${projectId}`
}

async function removeContainer() {
  try {
    await run('docker', ['rm', '-f', MOCK_OIDC_CONTAINER])
  } catch {
    // Absent is the goal.
  }
}

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`${MOCK_OIDC_PUBLIC_URL}/__control/requests`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error(`The mock OIDC container did not answer within ${timeoutMs} ms.`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Starts the mock, replacing a container a killed earlier run left behind.
 * @param {{ network?: string; timeoutMs?: number }} [options]
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export async function startMockOidcContainer(options = {}) {
  await removeContainer()
  await run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    MOCK_OIDC_CONTAINER,
    '--network',
    options.network ?? supabaseNetwork(),
    '-p',
    `127.0.0.1:${MOCK_OIDC_PORT}:8080`,
    '-e',
    'MOCK_OIDC_HOST=0.0.0.0',
    '-e',
    'MOCK_OIDC_PORT=8080',
    '-v',
    `${SCRIPT}:/mock-oidc.mjs:ro`,
    IMAGE,
    'node',
    '/mock-oidc.mjs',
  ])
  try {
    await waitForReady(options.timeoutMs ?? 30_000)
  } catch (error) {
    await removeContainer()
    throw error
  }
  return { close: removeContainer }
}
