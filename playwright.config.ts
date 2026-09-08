import { config as dotenvConfig } from 'dotenv'
import path from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'
import localConfig from './playwright/config/local.config'
import localRestrictedConfig, {
  isRestrictedEvidenceRun,
} from './playwright/config/local-restricted.config'
import previewConfig from './playwright/config/preview.config'
import prodConfig from './playwright/config/prod.config'

dotenvConfig({
  path: path.resolve(__dirname, '.env'),
})

const envConfigMap: Record<string, PlaywrightTestConfig> = {
  local: localConfig,
  preview: previewConfig,
  prod: prodConfig,
}

const desiredEnv = (process.env.TEST_ENV ?? 'local').toLowerCase()

if (!envConfigMap[desiredEnv]) {
  console.error(`No Playwright configuration found for TEST_ENV="${desiredEnv}"`)
  console.error(
    'Available environments:',
    Object.keys(envConfigMap)
      .map((env) => `\n- ${env}`)
      .join('')
  )
  process.exit(1)
}

// Restricted mode is a second axis on top of TEST_ENV. The value has to stay
// `local`: global teardown's db:reset is gated on that exact string, and it is
// what deletes the rows a real-model run leaves behind.
const restrictedRun = isRestrictedEvidenceRun()

if (restrictedRun && desiredEnv !== 'local') {
  console.error(`Restricted evidence runs require TEST_ENV="local", got "${desiredEnv}".`)
  console.error('Unset COMMUNITY_SCREENING_EVIDENCE_MODE to run that environment.')
  process.exit(1)
}

const config = restrictedRun ? localRestrictedConfig : envConfigMap[desiredEnv]

export default config
