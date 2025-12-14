import fs from 'node:fs'
import path from 'node:path'
import { resolveGitMetadata } from '../../apps/web/git-metadata'
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

function env(name: string) {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function slugifyVercelGitRef(value: string) {
  const normalized = value
    .replace(/^refs\/heads\//, '')
    .trim()
    .toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug || 'main'
}

function resolveLocalVercelPreviewUrl() {
  const projectSlug = env('VERCEL_WEB_PROJECT_SLUG')
  const teamSlug = env('VERCEL_TEAM_SLUG')
  if (!projectSlug || !teamSlug) return undefined

  const { gitBranch } = resolveGitMetadata()
  const branch =
    env('VERCEL_GIT_COMMIT_REF') ??
    env('GITHUB_HEAD_REF') ??
    env('GIT_BRANCH') ??
    gitBranch ??
    'main'

  const branchSlug = slugifyVercelGitRef(branch)
  return `https://${projectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
}

const environmentConfigs: Record<EnvironmentName, Omit<EnvironmentConfig, 'name'>> = {
  local: {
    webBaseUrl: env('WEB_E2E_BASE_URL') ?? env('WEB_BASE_URL') ?? 'http://localhost:3005',
    apiBaseUrl: env('API_BASE_URL') ?? 'http://localhost:4000',
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
      env('DEV_WEB_E2E_BASE_URL') ??
      env('DEV_WEB_BASE_URL') ??
      (env('VERCEL_BRANCH_URL') ? `https://${env('VERCEL_BRANCH_URL')}` : undefined) ??
      resolveLocalVercelPreviewUrl() ??
      'https://dev.couturecast.app',
    apiBaseUrl:
      env('DEV_API_BASE_URL') ??
      env('VERCEL_API_BRANCH_URL') ??
      (env('VERCEL_BRANCH_URL')
        ? `https://${env('VERCEL_BRANCH_URL')}`.replace(
            /(^https?:\/\/)([^.]+)\.([^.]+\.vercel\.app)/,
            (_match, proto, sub, rest) => `${proto}${sub}-api.${rest}`
          )
        : undefined) ??
      'https://dev-api.couturecast.app',
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
      env('PROD_WEB_E2E_BASE_URL') ??
      env('PROD_WEB_BASE_URL') ??
      'https://app.couturecast.com',
    apiBaseUrl: env('PROD_API_BASE_URL') ?? 'https://api.couturecast.com',
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

// test
