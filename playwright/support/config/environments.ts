import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const envPath = path.resolve(process.cwd(), '.env')
loadEnv({
  path: envPath,
})

export type EnvironmentName = 'local' | 'dev' | 'stage' | 'prod'

type Credentials = {
  email: string
  password: string
}

export type EnvironmentConfig = {
  name: EnvironmentName
  webBaseUrl: string
  apiBaseUrl: string
  credentials: {
    defaultUser: Credentials
  }
  apiHeaders: Record<string, string>
}

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const environmentConfigs: Record<EnvironmentName, Omit<EnvironmentConfig, 'name'>> = {
  local: {
    webBaseUrl:
      process.env.WEB_E2E_BASE_URL ?? process.env.WEB_BASE_URL ?? 'http://localhost:3005',
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
    credentials: {
      defaultUser: {
        email: process.env.AUTH_USERNAME ?? 'tester@example.com',
        password: process.env.AUTH_PASSWORD ?? 'local-password',
      },
    },
    apiHeaders: supabaseServiceRoleKey
      ? {
          apikey: supabaseServiceRoleKey,
          authorization: `Bearer ${supabaseServiceRoleKey}`,
        }
      : {},
  },
  dev: {
    webBaseUrl:
      process.env.DEV_WEB_E2E_BASE_URL ??
      process.env.DEV_WEB_BASE_URL ??
      'https://dev.couturecast.app',
    apiBaseUrl: process.env.DEV_API_BASE_URL ?? 'https://dev-api.couturecast.app',
    credentials: {
      defaultUser: {
        email: process.env.DEV_AUTH_USERNAME ?? 'dev.tester@couturecast.app',
        password: process.env.DEV_AUTH_PASSWORD ?? 'dev-password',
      },
    },
    apiHeaders: supabaseServiceRoleKey
      ? {
          apikey: supabaseServiceRoleKey,
          authorization: `Bearer ${supabaseServiceRoleKey}`,
        }
      : {},
  },
  stage: {
    webBaseUrl:
      process.env.STAGE_WEB_E2E_BASE_URL ??
      process.env.STAGE_WEB_BASE_URL ??
      'https://stage.couturecast.app',
    apiBaseUrl: process.env.STAGE_API_BASE_URL ?? 'https://stage-api.couturecast.app',
    credentials: {
      defaultUser: {
        email: process.env.STAGE_AUTH_USERNAME ?? 'stage.tester@couturecast.app',
        password: process.env.STAGE_AUTH_PASSWORD ?? 'stage-password',
      },
    },
    apiHeaders: supabaseServiceRoleKey
      ? {
          apikey: supabaseServiceRoleKey,
          authorization: `Bearer ${supabaseServiceRoleKey}`,
        }
      : {},
  },
  prod: {
    webBaseUrl:
      process.env.PROD_WEB_E2E_BASE_URL ??
      process.env.PROD_WEB_BASE_URL ??
      'https://app.couturecast.com',
    apiBaseUrl: process.env.PROD_API_BASE_URL ?? 'https://api.couturecast.com',
    credentials: {
      defaultUser: {
        email: process.env.PROD_AUTH_USERNAME ?? 'stylist@couturecast.com',
        password: process.env.PROD_AUTH_PASSWORD ?? 'strong-password',
      },
    },
    apiHeaders: supabaseServiceRoleKey
      ? {
          apikey: supabaseServiceRoleKey,
          authorization: `Bearer ${supabaseServiceRoleKey}`,
        }
      : {},
  },
}

export function resolveEnvironmentConfig(value?: string): EnvironmentConfig {
  const fallback = (process.env.TEST_ENV ?? 'local').toLowerCase()
  const normalized = (value ?? fallback) as EnvironmentName

  if (!(normalized in environmentConfigs)) {
    const supported = Object.keys(environmentConfigs).join(', ')
    throw new Error(`Unknown TEST_ENV "${value}". Supported options: ${supported}`)
  }

  const config = environmentConfigs[normalized as EnvironmentName]

  return {
    name: normalized as EnvironmentName,
    ...config,
  }
}
