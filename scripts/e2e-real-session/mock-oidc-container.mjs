/**
 * Story 6.17 D10, TEA-13: runs `mock-oidc.mjs` where GoTrue and every browser reach it by one URL.
 *
 * GoTrue's Keycloak provider (`supabase/config.toml`) has a single base URL. GoTrue calls its
 * token and userinfo endpoints from inside its own container, and sends the person's browser to
 * its authorize endpoint: a Playwright browser on the host, Custom Tabs on an Android emulator
 * (through `adb reverse`) or ASWebAuthenticationSession on an iOS simulator (the host's
 * loopback). A Docker network name such as `http://couturecast-mock-oidc:8080` resolves for
 * GoTrue only, so the base URL is `http://127.0.0.1:23052` and two containers make it true
 * everywhere:
 *
 * - The mock joins the GoTrue container's network namespace (`--network container:...`) and
 *   listens on that port there, so GoTrue's own loopback reaches it.
 * - A forwarder on the Supabase network publishes the same port on the host and relays each
 *   connection to GoTrue. A container that shares another's network
 *   namespace cannot publish ports itself.
 *
 * `127.0.0.1` over `localhost`: the forwarder publishes IPv4 only, and a client that tries `::1`
 * first would be refused before it falls back.
 *
 * Both run the stock Node image the stack already pulls; the mock runs the repository's own
 * script read-only. They hold no state beyond the run and are removed on release. A Supabase
 * restart recreates the GoTrue container and with it the namespace, so start the mock after
 * `supabase start`.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const MOCK_OIDC_CONTAINER = 'couturecast-mock-oidc'
export const MOCK_OIDC_FORWARDER_CONTAINER = 'couturecast-mock-oidc-forward'
// A runner's outgoing socket can take a port in Linux's ephemeral range before Docker binds it.
export const MOCK_OIDC_PORT = 23052
/** The one origin GoTrue, the host and both device browsers use; `config.toml` names it. */
export const MOCK_OIDC_URL = `http://127.0.0.1:${MOCK_OIDC_PORT}`
const IMAGE = 'node:24-slim'
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-oidc.mjs')

/** `supabase_network_<project_id>`, the network `supabase start` creates. */
export function supabaseNetwork(projectId = 'couture-cast') {
  return `supabase_network_${projectId}`
}

/** `supabase_auth_<project_id>`, the GoTrue container `supabase start` creates. */
export function supabaseAuthContainer(projectId = 'couture-cast') {
  return `supabase_auth_${projectId}`
}

/**
 * The forwarder's program: every connection is piped to the same port on `target`, and an error
 * on either side ends both and is logged for the run's evidence.
 * @param {string} target
 */
export function forwarderScript(target) {
  return [
    "const net = require('node:net')",
    'net',
    '  .createServer((client) => {',
    `    const upstream = net.connect(${MOCK_OIDC_PORT}, ${JSON.stringify(target)})`,
    '    client.pipe(upstream).pipe(client)',
    '    client.on("error", (error) => {',
    '      console.error(`client ${error.code ?? error.message}`)',
    '      upstream.destroy()',
    '    })',
    '    upstream.on("error", (error) => {',
    '      console.error(`upstream ${error.code ?? error.message}`)',
    '      client.destroy()',
    '    })',
    '  })',
    `  .listen(${MOCK_OIDC_PORT}, '0.0.0.0')`,
  ].join('\n')
}

/**
 * The two `docker run` argument lists, mock first.
 * @param {{ network?: string; authContainer?: string }} [options]
 */
export function mockOidcContainerArgs(options = {}) {
  const authContainer = options.authContainer ?? supabaseAuthContainer()
  return [
    [
      'run',
      '-d',
      '--rm',
      '--name',
      MOCK_OIDC_CONTAINER,
      '--network',
      `container:${authContainer}`,
      '-e',
      'MOCK_OIDC_HOST=0.0.0.0',
      '-e',
      `MOCK_OIDC_PORT=${MOCK_OIDC_PORT}`,
      '-v',
      `${SCRIPT}:/mock-oidc.mjs:ro`,
      IMAGE,
      'node',
      '/mock-oidc.mjs',
    ],
    [
      'run',
      '-d',
      '--rm',
      '--name',
      MOCK_OIDC_FORWARDER_CONTAINER,
      '--network',
      options.network ?? supabaseNetwork(),
      '-p',
      `127.0.0.1:${MOCK_OIDC_PORT}:${MOCK_OIDC_PORT}`,
      IMAGE,
      'node',
      '-e',
      forwarderScript(authContainer),
    ],
  ]
}

async function removeContainers() {
  for (const name of [MOCK_OIDC_FORWARDER_CONTAINER, MOCK_OIDC_CONTAINER]) {
    try {
      await run('docker', ['rm', '-f', name])
    } catch {
      // Absent is the goal.
    }
  }
}

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`${MOCK_OIDC_URL}/__control/requests`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error(`The mock OIDC containers did not answer within ${timeoutMs} ms.`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Both containers' output, for a run's logs before release removes them. */
async function containerLogs() {
  const parts = []
  for (const name of [MOCK_OIDC_CONTAINER, MOCK_OIDC_FORWARDER_CONTAINER]) {
    try {
      const { stdout, stderr } = await run('docker', ['logs', name])
      parts.push(`== ${name}\n${stdout}${stderr}`)
    } catch (error) {
      parts.push(`== ${name}\n(no logs: ${error.message})`)
    }
  }
  return parts.join('\n')
}

/**
 * Starts the mock and its forwarder, replacing containers a killed earlier run left behind.
 * @param {{ network?: string; authContainer?: string; timeoutMs?: number }} [options]
 * @returns {Promise<{ close: () => Promise<void>; logs: () => Promise<string> }>}
 */
export async function startMockOidcContainer(options = {}) {
  await removeContainers()
  try {
    for (const args of mockOidcContainerArgs(options)) await run('docker', args)
    await waitForReady(options.timeoutMs ?? 30_000)
  } catch (error) {
    await removeContainers()
    throw error
  }
  return { close: removeContainers, logs: containerLogs }
}
