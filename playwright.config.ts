import { config as dotenvConfig } from 'dotenv'
import path from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'

dotenvConfig({
  path: path.resolve(__dirname, '.env'),
})

const envConfigMap: Record<string, PlaywrightTestConfig> = {
  local: require('./playwright/config/local.config').default,
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
