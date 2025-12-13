import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

// Load environment file based on TEST_ENV (falls back to .env)
const envSuffix = (process.env.TEST_ENV ?? process.env.NODE_ENV ?? 'local').toLowerCase()
const envFiles = [`.env.${envSuffix}`, '.env']
for (const file of envFiles) {
  const envPath = path.resolve(process.cwd(), file)
  if (fs.existsSync(envPath)) {
    loadEnv({ path: envPath })
    break
  }
}

export type EnvironmentName = 'local' | 'dev' | 'prod'

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

function isEnvironmentName(value: string): value is EnvironmentName {
  return (value as EnvironmentName) in environmentConfigs
}

export function resolveEnvironmentConfig(value?: string): EnvironmentConfig {
  const fallback = (process.env.TEST_ENV ?? 'local').toLowerCase()
  const normalized = (value ?? fallback).toLowerCase()

  if (!isEnvironmentName(normalized)) {
    const supported = Object.keys(environmentConfigs).join(', ')
    throw new Error(`Unknown TEST_ENV "${value}". Supported options: ${supported}`)
  }

  const config = environmentConfigs[normalized]

  return {
    name: normalized,
    ...config,
  }
}
