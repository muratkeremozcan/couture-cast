import fs from 'node:fs'
import path from 'node:path'
import { request, type FullConfig } from '@playwright/test'

/**
 * Where the Vercel bypass cookies land. Under the git-ignored `playwright/.auth`,
 * which no workflow uploads.
 */
export const VERCEL_BYPASS_STATE_PATH = path.resolve(
  __dirname,
  '.auth',
  'vercel-bypass.json'
)

const EMPTY_STATE = { cookies: [], origins: [] }

/**
 * Exchanges VERCEL_AUTOMATION_BYPASS_SECRET for Vercel's bypass cookies before any
 * test starts, so the secret itself never travels inside a test.
 *
 * Anything a test sends is recorded: a trace stores the context options
 * (`extraHTTPHeaders` included) and the raw headers of every request, and the HTML
 * and blob reports carry those traces as attachments. Sending the secret as a header
 * from tests therefore copied it into every retained trace. Global setup runs in the
 * runner process with no tracing, so the secret stops here and tests carry only the
 * deployment-scoped `_vercel_jwt` cookie Vercel issues for it, through
 * `use.storageState`.
 *
 * `samesitenone` because the page and the API are different preview origins.
 */
export default async function globalSetup(config: FullConfig) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  let state: unknown = EMPTY_STATE

  if (secret) {
    const metadata = config.metadata as Record<string, string | undefined>
    const origins = new Set(
      [metadata.baseUrl, metadata.apiBaseUrl]
        .filter((url): url is string => Boolean(url))
        .map((url) => new URL(url).origin)
    )
    const context = await request.newContext({
      extraHTTPHeaders: {
        'x-vercel-protection-bypass': secret,
        'x-vercel-set-bypass-cookie': 'samesitenone',
      },
    })
    try {
      for (const origin of origins) {
        const response = await context.get(`${origin}/api/health`, {
          failOnStatusCode: false,
        })
        if (response.status() === 401 || response.status() === 403) {
          throw new Error(
            `Vercel rejected VERCEL_AUTOMATION_BYPASS_SECRET for ${origin} ` +
              `(HTTP ${response.status()}). Verify the bypass secret is valid for this project.`
          )
        }
      }
      state = await context.storageState()
    } finally {
      await context.dispose()
    }
  }

  fs.mkdirSync(path.dirname(VERCEL_BYPASS_STATE_PATH), { recursive: true })
  fs.writeFileSync(VERCEL_BYPASS_STATE_PATH, JSON.stringify(state), { mode: 0o600 })
}
