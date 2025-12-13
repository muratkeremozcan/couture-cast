import { config as dotenvConfig } from 'dotenv'
import path from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'
import localConfig from './playwright/config/local.config'
import devConfig from './playwright/config/dev.config'
import prodConfig from './playwright/config/prod.config'

dotenvConfig({
  path: path.resolve(__dirname, '.env'),
})

const envConfigMap: Record<string, PlaywrightTestConfig> = {
  local: localConfig,
  dev: devConfig,
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

const config = envConfigMap[desiredEnv]

export default config
