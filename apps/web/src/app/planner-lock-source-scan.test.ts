// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-032 (AC4, D10), web half. No web screen shows a
// Planner lock: the lock panels' test ids and the `commerce.premium.plannerLocked` strings are
// referenced nowhere in the web sources. Plan's free preview (`plan-free-preview`) is the only
// place a free member meets the planner. Tests are left out: they name the old ids to assert
// their absence. The mobile half is apps/mobile/src/screens/planner-lock-source-scan.test.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const NOT_SOURCE = [
  /\.(test|spec)\.(ts|tsx)$/,
  /\.test-[^/]*\.(ts|tsx)$/,
  /(^|\/)test-utils\//,
] as const

/** Every web source under apps/web/src, keyed by its path from there. */
const webSources: Record<string, string> = Object.fromEntries(
  files(SRC)
    .map((path) => relative(SRC, path))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !NOT_SOURCE.some((pattern) => pattern.test(file)))
    .map((file) => [file, readFileSync(join(SRC, file), 'utf8')])
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
    source
      .split('\n')
      .flatMap((line, index) =>
        LOCK_REFERENCES.some((pattern) => pattern.test(line))
          ? [`${file}:${index + 1}: ${line.trim()}`]
          : []
      )
  )
}

describe('No Planner lock outside Plan in the web app (Story CC-7.12 D10)', () => {
  it('[P0] [7.12-NAT-032] the scan reads the web app (it is not vacuous)', () => {
    const web = Object.keys(webSources)
    expect(web).toEqual(
      expect.arrayContaining([
        'app/components/planner-rail.tsx',
        'app/components/looks-screen.tsx',
        'app/components/looks/free-plan-preview.tsx',
      ])
    )
    expect(web.some((file) => /\.(test|spec)\.tsx?$/.test(file))).toBe(false)
    // The free preview the lock gave way to is in the web planner.
    expect(webSources['app/components/looks/free-plan-preview.tsx']).toContain(
      'plan-free-preview'
    )
  })

  it('[P0] [7.12-NAT-032] no web source references a Planner lock id or string', () => {
    expect(lockReferences(webSources)).toEqual([])
  })
})
