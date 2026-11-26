// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-HOME-PLAN-05, the old Home drawer deep link
// `/?planner=1` redirects to the Plan route on the server (D9, next.config.ts), so a saved link or
// a notification keeps opening the planner. The Plan screen dropping the passed-through query is
// app/looks/plan/page.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('7.11 legacy planner deep link', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('7.11-CMP-HOME-PLAN-05 redirects /?planner=1 to /looks/plan, temporarily, and nothing else', async () => {
    vi.resetModules()
    // next.config fills only undefined keys from the root .env files; blank keeps them out.
    for (const key of ['PROD_API_BASE_URL', 'API_BASE_URL', 'VERCEL_ENV'])
      vi.stubEnv(key, '')
    const { default: config } = await import('../../../../next.config')

    expect(await config.redirects!()).toEqual([
      {
        source: '/',
        has: [{ type: 'query', key: 'planner', value: '1' }],
        destination: '/looks/plan',
        permanent: false,
      },
    ])
  })
})
