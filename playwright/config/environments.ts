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

function firstDefined<T>(...values: (T | undefined)[]): T {
  for (const value of values) {
    if (value !== undefined) return value
  }
  throw new Error('No defined value found')
}

const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const vercelBypassSecret = env('VERCEL_AUTOMATION_BYPASS_SECRET')
const apiProjectSlug = env('VERCEL_API_PROJECT_SLUG') ?? 'couture-cast-api'
const webProjectSlug = env('VERCEL_WEB_PROJECT_SLUG') ?? 'couture-cast-web'
const defaultTeamSlug = env('VERCEL_TEAM_SLUG') ?? 'muratkeremozcans-projects'

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
  const projectSlug = webProjectSlug
  const teamSlug = defaultTeamSlug
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

function resolveLocalVercelApiPreviewUrl() {
  const projectSlug = apiProjectSlug
  const teamSlug = defaultTeamSlug
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
  dev: (() => {
    const webBaseUrl = firstDefined(
      env('DEV_WEB_E2E_BASE_URL'),
      env('DEV_WEB_BASE_URL'),
      env('VERCEL_BRANCH_URL') ? `https://${env('VERCEL_BRANCH_URL')}` : undefined,
      resolveLocalVercelPreviewUrl(),
      'https://dev.couturecast.app'
    )

    const apiBaseUrl = firstDefined(
      env('DEV_API_BASE_URL'),
      env('VERCEL_API_BASE_URL'),
      env('VERCEL_API_BRANCH_URL'),
      resolveLocalVercelApiPreviewUrl(),
      'https://dev-api.couturecast.app'
    )

    return {
      webBaseUrl,
      apiBaseUrl,
      credentials: {
        defaultUser: {
          email: process.env.DEV_AUTH_USERNAME ?? 'dev.tester@couturecast.app',
          password: process.env.DEV_AUTH_PASSWORD ?? 'dev-password',
        },
      },
      apiHeaders:
        supabaseServiceRoleKey || vercelBypassSecret
          ? {
              ...(supabaseServiceRoleKey
                ? {
                    apikey: supabaseServiceRoleKey,
                    authorization: `Bearer ${supabaseServiceRoleKey}`,
                  }
                : {}),
              ...(vercelBypassSecret
                ? {
                    'x-vercel-protection-bypass': vercelBypassSecret,
                    'x-vercel-set-bypass-cookie': 'true',
                  }
                : {}),
            }
          : {},
    }
  })(),
  prod: {
    webBaseUrl:
      env('PROD_WEB_E2E_BASE_URL') ??
      env('PROD_WEB_BASE_URL') ??
      // Fixed Vercel production domain
      'https://couture-cast-web.vercel.app',
    apiBaseUrl:
      env('PROD_API_BASE_URL') ??
      // Fixed Vercel production API domain
      'https://couture-cast-api.vercel.app',
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
