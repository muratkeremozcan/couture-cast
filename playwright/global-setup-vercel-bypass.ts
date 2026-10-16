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
 * The minted cookie is a credential GitHub knows nothing about, and a failed request
 * prints its headers, cookies included, in the call log. Registering each value
 * makes the runner mask it in every later line of the job's log. The workflow
 * command itself is consumed by the runner, never shown.
 */
function maskInGitHubActions(values: string[]) {
  if (process.env.GITHUB_ACTIONS !== 'true') return
  for (const value of values) {
    if (value) process.stdout.write(`::add-mask::${value}\n`)
  }
}

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
        const response = await context
          .get(`${origin}/api/health`, { failOnStatusCode: false })
          .catch((error: unknown) => {
            // Playwright's call log lists the request headers, the secret
            // among them, so none of its message is passed on.
            const name = error instanceof Error ? error.name : 'Error'
            throw new Error(
              `Could not reach ${origin} to mint the Vercel bypass cookie (${name}).`
            )
          })
        if (response.status() === 401 || response.status() === 403) {
          throw new Error(
            `Vercel rejected VERCEL_AUTOMATION_BYPASS_SECRET for ${origin} ` +
              `(HTTP ${response.status()}). Verify the bypass secret is valid for this project.`
          )
        }
      }
      const minted = await context.storageState()
      maskInGitHubActions(minted.cookies.map((cookie) => cookie.value))
      state = minted
    } finally {
      await context.dispose()
    }
  }

  fs.mkdirSync(path.dirname(VERCEL_BYPASS_STATE_PATH), { recursive: true })
  fs.writeFileSync(VERCEL_BYPASS_STATE_PATH, JSON.stringify(state), { mode: 0o600 })
}
