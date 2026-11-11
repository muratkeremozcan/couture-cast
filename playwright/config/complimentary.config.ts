// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA (TEA-15): the complimentary access spec on its own runtime.
//
// `npm run test:pw-complimentary` (scripts/e2e-complimentary/run.mjs) creates one
// UUID-named database, passes its URL and this stack's own ports in
// COMPLIMENTARY_E2E_OWNED_ENV, runs this config, then drops the database. Every other
// config ignores the spec (base.config.ts testIgnore), because it turns the six member
// flags off globally, which would break the shared parallel run.
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import localConfig from './local.config'

const ownedJson = process.env.COMPLIMENTARY_E2E_OWNED_ENV
if (!ownedJson)
  throw new Error(
    'COMPLIMENTARY_E2E_OWNED_ENV is unset. Run the complimentary spec with npm run test:pw-complimentary.'
  )
const owned = JSON.parse(ownedJson) as Record<string, string>
// Importing the local config loaded .env.local over the environment. Put the run's own
// database and origins back before any test module or the stack reads them.
Object.assign(process.env, owned)

const databaseName = new URL(owned.DATABASE_URL ?? '').pathname.slice(1)
if (!/^tea_cc614_e2e_[a-f0-9]{32}$/.test(databaseName))
  throw new Error(
    'DATABASE_URL must name the runner-owned tea_cc614_e2e_<32 hex> database.'
  )

const webBaseUrl = owned.WEB_E2E_BASE_URL!
const apiBaseUrl = owned.API_BASE_URL!

export default defineConfig({
  ...merge({}, localConfig, {
    use: { baseURL: webBaseUrl },
    metadata: {
      baseUrl: webBaseUrl,
      apiBaseUrl,
      healthEndpoint: new URL('/api/health', webBaseUrl).toString(),
    },
    webServer: {
      url: webBaseUrl,
      env: { ...owned, REUSE_EXISTING_WEB_SERVER: 'false' },
    },
  }),
  // Set outside the merge: lodash.merge walks arrays index by index.
  testIgnore: [],
  testMatch: /complimentary-access\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
})
