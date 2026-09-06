// Learning path Step 12: Cross-surface E2E confidence.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-12-cross-surface-e2e-confidence
import type { AxeResults } from 'axe-core'
import type axe from 'axe-core'
import { z } from 'zod'
import { test, expect } from '../support/fixtures/merged-fixtures'

const healthResponseSchema = z.object({
  status: z.string(),
})

test.describe('Web smoke', () => {
  test('hero renders with healthy services and passes accessibility scan', async ({
    apiRequest,
    page,
    interceptNetworkCall,
    validateSchema,
  }, testInfo) => {
    const pollCallPromise = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/events/poll*',
      fulfillResponse: {
        status: 200,
        body: {
          events: [],
          nextSince: null,
        },
      },
    })

    const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
    const healthEndpoint =
      metadata.healthEndpoint ??
      new URL('/api/health', metadata.baseUrl ?? 'http://localhost:3005').toString()

    const healthUrl = new URL(healthEndpoint)
    const vercelBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    const healthResponse = await apiRequest<{ status: string }>({
      method: 'GET',
      baseUrl: healthUrl.origin,
      path: healthUrl.pathname,
      headers: vercelBypassToken
        ? {
            'x-vercel-protection-bypass': vercelBypassToken,
            'x-vercel-set-bypass-cookie': 'true',
          }
        : undefined,
    })
    expect(healthResponse.status).toBe(200)

    await validateSchema(healthResponseSchema, healthResponse.body, {
      shape: { status: 'ok' },
    })

    await page.goto('/')
    const pollCall = await pollCallPromise
    expect(pollCall.status).toBe(200)

    await expect(page.getByTestId('hero-headline')).toContainText(
      'Plan confident outfits'
    )
    await expect(page.getByTestId('primary-nav')).toBeVisible()
    await expect(page.getByTestId('hero-cta-group')).toBeVisible()
    await expect(page.getByTestId('health-indicator')).toBeVisible()

    await page.addScriptTag({ path: require.resolve('axe-core') })

    const accessibilityScan = await page.evaluate<AxeResults>(async () => {
      const axeInstance = (window as typeof window & { axe: typeof axe }).axe
      return axeInstance.run(document.body, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa'],
        },
      })
    })

    expect(accessibilityScan.violations, 'axe accessibility violations').toEqual([])
  })
})
