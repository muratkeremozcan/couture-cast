// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-032 (AC4, D10). No mobile screen shows a Planner
// lock: the lock panels' test ids and the `commerce.premium.plannerLocked` strings are referenced
// nowhere in the mobile sources. Plan's free preview (`plan-free-preview`) is the only place a
// free member meets the planner. Tests are left out: they name the old ids to assert their
// absence. The web half is apps/web/src/app/planner-lock-source-scan.test.ts, so each app's
// coverage lane wakes on its own sources (scripts/ci/lanes.test.mjs).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'

// The mobile suite runs in Chromium, which has no file system: Vite expands this glob when it
// serves the test. Vite's dependency scan accepts only literal patterns: a spread or a constant
// here fails the scan for the whole suite ("Invalid glob import syntax: Could only use
// literals"), every dependency is then found mid-run and Vite reloads the browser (PR 296, run
// 45903711258). tsc reads the app as CommonJS, where `import.meta` has no meaning (TS1470), the
// same exception edge-to-edge-modal.test.tsx takes for its caller scan.
// @ts-expect-error TS1470: the expression is Vite's, never CommonJS output.
const mobileSources: Record<string, string> = import.meta.glob(
  [
    '../../app/**/*.{ts,tsx}',
    '../**/*.{ts,tsx}',
    '../../components/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/*.spec.{ts,tsx}',
    '!**/*.test-*.{ts,tsx}',
    '!**/test-utils/**',
  ],
  { query: '?raw', import: 'default', eager: true }
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

describe('No Planner lock outside Plan in the mobile app (Story CC-7.12 D10)', () => {
  it('[P0] [7.12-NAT-032] the scan reads the mobile app (it is not vacuous)', () => {
    const mobile = Object.keys(mobileSources)
    expect(mobile).toEqual(
      expect.arrayContaining([
        '../features/premium/planner-screen.tsx',
        '../features/looks/looks-screen.tsx',
        '../../app/(tabs)/settings.tsx',
      ])
    )
    expect(mobile.some((file) => /\.test\.tsx?$/.test(file))).toBe(false)
    // The free preview the lock gave way to is in the mobile planner.
    expect(String(mobileSources['../features/premium/planner-screen.tsx'])).toContain(
      'plan-free-preview'
    )
  })

  it('[P0] [7.12-NAT-032] no mobile source references a Planner lock id or string', () => {
    expect(lockReferences(mobileSources)).toEqual([])
  })
})
