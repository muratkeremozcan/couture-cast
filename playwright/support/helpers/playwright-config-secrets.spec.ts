/**
 * Playwright serializes `config.webServer` and `config.metadata` verbatim into
 * every blob report, and copies `use.extraHTTPHeaders` into every trace. These
 * tests load each environment's real config with dummy secrets in the process
 * environment and assert none of them reaches those serialized fields.
 *
 * `webServer.env` must hold only explicit overrides: Playwright's web server
 * plugin already starts the command with `{ ...process.env, ...webServer.env }`
 * (playwright/lib/plugins/webServerPlugin.js), so the runner's environment does
 * not need to be, and must not be, copied into the config.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaywrightTestConfig } from '@playwright/test'

const DUMMY_SECRETS = {
  GUARDIAN_INVITE_JWT_SECRET: 'dummy-guardian-secret-for-config-test',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'dummy-vercel-bypass-for-config-test',
  VERCEL_TOKEN: 'dummy-vercel-token-for-config-test',
  DATABASE_URL_PROD: 'postgresql://dummy:dummy-password@prod.invalid:5432/db',
  GH_TOKEN: 'dummy-gh-token-for-config-test',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key-for-config-test',
  UNRELATED_CI_VARIABLE: 'dummy-unrelated-ci-variable',
}

const LOCAL_WEB_SERVER_ENV_KEYS = [
  'API_BASE_URL',
  'POSTHOG_API_KEY',
  'PUBLIC_API_URL',
  'REUSE_EXISTING_WEB_SERVER',
  'TEST_ENV',
  'WEB_E2E_BASE_URL',
]

async function loadConfig(file: string): Promise<PlaywrightTestConfig> {
  vi.resetModules()
  for (const [name, value] of Object.entries(DUMMY_SECRETS)) vi.stubEnv(name, value)
  const module = (await import(file)) as { default: PlaywrightTestConfig }
  return module.default
}

function webServerEnv(config: PlaywrightTestConfig) {
  const webServer = config.webServer
  if (!webServer || Array.isArray(webServer)) {
    throw new Error('expected a single webServer entry')
  }
  return webServer.env ?? {}
}

function expectNoDummySecret(serialized: unknown) {
  const text = JSON.stringify(serialized)
  for (const [name, value] of Object.entries(DUMMY_SECRETS)) {
    expect(text, `${name} leaked into serialized config`).not.toContain(value)
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Playwright configs keep the environment out of reports', () => {
  it('local webServer.env holds only its explicit overrides', async () => {
    const config = await loadConfig('../../config/local.config')

    expect(Object.keys(webServerEnv(config)).sort()).toEqual(LOCAL_WEB_SERVER_ENV_KEYS)
    expect(config.use?.extraHTTPHeaders).toBeUndefined()
    expectNoDummySecret({ webServer: config.webServer, metadata: config.metadata })
  })

  it('restricted-evidence webServer.env adds only the evidence mode', async () => {
    const config = await loadConfig('../../config/local-restricted.config')

    expect(Object.keys(webServerEnv(config)).sort()).toEqual(
      [...LOCAL_WEB_SERVER_ENV_KEYS, 'COMMUNITY_SCREENING_EVIDENCE_MODE'].sort()
    )
    expect(config.use?.extraHTTPHeaders).toBeUndefined()
    expectNoDummySecret({ webServer: config.webServer, metadata: config.metadata })
  })

  it.each(['preview', 'prod'])(
    '%s sends no secret from tests and serializes none',
    async (name) => {
      const config = await loadConfig(`../../config/${name}.config`)

      expect(config.webServer).toBeUndefined()
      // Browser contexts carry no service-role header; only the request fixture does.
      expect(config.use?.extraHTTPHeaders).toBeUndefined()
      // The bypass cookie minted from the secret is a credential too, and
      // traces record cookies, so preview records none while it holds one.
      if (name === 'preview') expect(config.use?.trace).toBe('off')
      expectNoDummySecret({
        metadata: config.metadata,
        extraHTTPHeaders: config.use?.extraHTTPHeaders,
      })
    }
  )
})
