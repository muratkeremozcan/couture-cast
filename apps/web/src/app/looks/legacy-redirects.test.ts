// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-060, the server redirects in next.config.ts. The
// CC-7.11 Plan route (`/looks/plan`), the old Home drawer link (`/?planner=1`) and the capsules
// address (`/wardrobe/capsules`) open Looks on Plan or on Saved with Capsules (D6, D11). This file
// replaces app/looks/plan/legacy-redirect.test.ts (7.11-CMP-HOME-PLAN-05), whose route is gone.
// Dropping the passed-through `planner` key is in app/looks/page.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLooksFilter, parseLooksSegment } from '@couture/utils'

async function loadRedirects() {
  vi.resetModules()
  // next.config fills only undefined keys from the root .env files; blank keeps them out.
  for (const key of ['PROD_API_BASE_URL', 'API_BASE_URL', 'VERCEL_ENV'])
    vi.stubEnv(key, '')
  const { default: config } = await import('../../../next.config')
  return config.redirects!()
}

describe('7.12 legacy Looks redirects (D6, D11)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('7.12-UNIT-060a redirects /?planner=1, /looks/plan and /wardrobe/capsules to Looks, temporarily, and nothing else', async () => {
    expect(await loadRedirects()).toEqual([
      {
        source: '/',
        has: [{ type: 'query', key: 'planner', value: '1' }],
        destination: '/looks?segment=plan',
        permanent: false,
      },
      { source: '/looks/plan', destination: '/looks?segment=plan', permanent: false },
      {
        source: '/wardrobe/capsules',
        destination: '/looks?segment=saved&filter=capsules',
        permanent: false,
      },
    ])
  })

  it('7.12-UNIT-060b every destination is an address the Looks screen reads as the intended segment and filter', async () => {
    const targets = new Map(
      (await loadRedirects()).map((redirect) => {
        const url = new URL(redirect.destination, 'https://couture.test')
        return [
          redirect.source + (redirect.has ? '?planner=1' : ''),
          {
            path: url.pathname,
            segment: parseLooksSegment(url.searchParams.get('segment')),
            filter: parseLooksFilter(url.searchParams.get('filter')),
            // The destination names only these keys; Next appends the source query to
            // them, which keeps a legacy query (D6).
            keys: [...url.searchParams.keys()],
          },
        ]
      })
    )

    expect(targets.get('/?planner=1')).toEqual({
      path: '/looks',
      segment: 'plan',
      filter: 'all',
      keys: ['segment'],
    })
    expect(targets.get('/looks/plan')).toEqual({
      path: '/looks',
      segment: 'plan',
      filter: 'all',
      keys: ['segment'],
    })
    expect(targets.get('/wardrobe/capsules')).toEqual({
      path: '/looks',
      segment: 'saved',
      filter: 'capsules',
      keys: ['segment', 'filter'],
    })
  })
})
