import { config as loadEnv } from 'dotenv'
import type { ConfigContext } from 'expo/config'
import path from 'node:path'

const rootDir = path.resolve(__dirname, '../..')
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
  '.env',
]

for (const file of rootEnvFiles) {
  loadEnv({ path: path.join(rootDir, file), override: false, quiet: true })
}

export default ({ config }: ConfigContext) => ({
  ...config,
  extra: {
    ...config.extra,
    posthogApiKey: process.env.POSTHOG_API_KEY ?? '',
    posthogHost: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
  },
})
