// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-032 (AC4, D10). No screen in either app shows a
// Planner lock: the lock panels' test ids and the `commerce.premium.plannerLocked` strings are
// referenced nowhere in the mobile and web sources. Plan's free preview (`plan-free-preview`) is
// the only place a free member meets the planner. Tests are left out: they name the old ids to
// assert their absence.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'

const NOT_TESTS = [
  '!**/*.test.{ts,tsx}',
  '!**/*.spec.{ts,tsx}',
  '!**/*.test-*.{ts,tsx}',
  '!**/test-utils/**',
] as const

// The mobile suite runs in Chromium, which has no file system: Vite expands these globs when it
// serves the test. tsc reads the app as CommonJS, where `import.meta` has no meaning (TS1470),
// the same exception edge-to-edge-modal.test.tsx takes for its caller scan.
// @ts-expect-error TS1470: the expression is Vite's, never CommonJS output.
const mobileSources: Record<string, string> = import.meta.glob(
  [
    '../../app/**/*.{ts,tsx}',
    '../**/*.{ts,tsx}',
    '../../components/**/*.{ts,tsx}',
    ...NOT_TESTS,
  ],
  { query: '?raw', import: 'default', eager: true }
)

// @ts-expect-error TS1470: the expression is Vite's, never CommonJS output.
const webSources: Record<string, string> = import.meta.glob(
  ['../../../web/src/**/*.{ts,tsx}', ...NOT_TESTS],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
)

/** The CC-7.11 lock panels' ids (web and native) and the lock strings' catalog key. */
const LOCK_REFERENCES = [
  /planner-locked/,
  /planner-rail-locked/,
  /planner-rail-get-premium/,
  /plannerLocked/,
] as const

function lockReferences(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, source]) =>
    String(source)
      .split('\n')
      .flatMap((line, index) =>
        LOCK_REFERENCES.some((pattern) => pattern.test(line))
          ? [`${file}:${index + 1}: ${line.trim()}`]
          : []
      )
  )
}

describe('No Planner lock outside Plan (Story CC-7.12 D10)', () => {
  it('[P0] [7.12-NAT-032] the scan reads both apps (it is not vacuous)', () => {
    const mobile = Object.keys(mobileSources)
    const web = Object.keys(webSources)
    expect(mobile).toEqual(
      expect.arrayContaining([
        '../features/premium/planner-screen.tsx',
        '../features/looks/looks-screen.tsx',
        '../../app/(tabs)/settings.tsx',
      ])
    )
    expect(web).toEqual(
      expect.arrayContaining([
        '../../../web/src/app/components/planner-rail.tsx',
        '../../../web/src/app/components/looks-screen.tsx',
      ])
    )
    expect(mobile.some((file) => /\.test\.tsx?$/.test(file))).toBe(false)
    // The free preview the lock gave way to is in both planners.
    expect(String(mobileSources['../features/premium/planner-screen.tsx'])).toContain(
      'plan-free-preview'
    )
    expect(
      String(webSources['../../../web/src/app/components/looks/free-plan-preview.tsx'])
    ).toContain('plan-free-preview')
  })

  it('[P0] [7.12-NAT-032] no mobile source references a Planner lock id or string', () => {
    expect(lockReferences(mobileSources)).toEqual([])
  })

  it('[P0] [7.12-NAT-032] no web source references a Planner lock id or string', () => {
    expect(lockReferences(webSources)).toEqual([])
  })
})
