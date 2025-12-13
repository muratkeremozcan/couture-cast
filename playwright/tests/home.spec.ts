import type { AxeResults } from 'axe-core'
import type axe from 'axe-core'
import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('Web smoke', () => {
  test('hero renders with healthy services and passes accessibility scan', async ({
    page,
  }, testInfo) => {
    const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
    const healthEndpoint =
      metadata.healthEndpoint ??
      new URL('/api/health', metadata.baseUrl ?? 'http://localhost:3005').toString()

    const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS?.trim()
    const healthResponse = await page.request.get(healthEndpoint, {
      headers: vercelBypassToken
        ? {
            'x-vercel-protection-bypass': vercelBypassToken,
            'x-vercel-set-bypass-cookie': 'true',
          }
        : undefined,
    })
    expect(healthResponse.ok()).toBeTruthy()

    const body = (await healthResponse.json()) as { status: string }
    expect(body.status).toBe('ok')

    await page.goto('/')

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
