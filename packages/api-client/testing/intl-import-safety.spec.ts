import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Guard: no module in this package may touch an optional `Intl` API while it is
 * being evaluated.
 *
 * This exists because of a defect that survived four months of a green CI.
 * `contracts/http/wardrobe.ts` constructed an `Intl.Segmenter` at module scope.
 * Hermes ships no `Intl.Segmenter`, so on a real device the import threw, the
 * mobile tab layout never mounted, and every one of the eighteen Maestro flows
 * died at `launchApp`.
 *
 * Nothing in the test pyramid could catch it. Unit tests run in Node, jsdom or
 * chromium; Pact runs in Node; Playwright runs in a browser. All of them ship
 * the full ECMA-402 surface, so all of them imported the module happily. Only
 * Maestro runs Hermes, and by the time Maestro sees it the failure presents as
 * "the app did not start", which reads like a harness problem rather than an
 * import-time throw in a shared package.
 *
 * So the runtime difference is simulated here instead: delete the optional APIs
 * a Hermes-class runtime lacks, reset the module registry so module-scope code
 * genuinely re-runs, and import every module in the package fresh. A lazy,
 * feature-detected use behind a function boundary still passes -- which is the
 * shape the wardrobe fix adopted, and the shape this guard is asking for.
 */

/**
 * Optional under ECMA-402 and absent from Hermes. `Intl.DateTimeFormat`,
 * `NumberFormat` and `Collator` are deliberately NOT in this list: Hermes does
 * provide them, so deleting them would fail modules for a reason no device
 * would ever reproduce.
 */
const OPTIONAL_INTL_APIS = [
  'Segmenter',
  'ListFormat',
  'DisplayNames',
  'RelativeTimeFormat',
  'PluralRules',
  'DurationFormat',
] as const

/**
 * Anchored on the working directory rather than `import.meta.url`, because this
 * package emits CommonJS and TypeScript rejects `import.meta` in that mode
 * (TS1470) even though Vitest executes this file as ESM. Vitest runs the suites
 * with the package root as the working directory; the manifest check turns any
 * other working directory into a loud failure here instead of a silent walk
 * over the wrong tree.
 */
const packageRoot = process.cwd()
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  name?: string
}

if (manifest.name !== '@couture/api-client') {
  throw new Error(
    `Expected the @couture/api-client package root as the working directory, found ${
      manifest.name ?? 'an unnamed package'
    } at ${packageRoot}`
  )
}

const srcDir = join(packageRoot, 'src')

function collectModules(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return collectModules(full)
    }
    if (!full.endsWith('.ts') || full.endsWith('.d.ts')) {
      return []
    }
    return [full]
  })
}

/**
 * Every module, including `src/generated/**`. The generated client is excluded
 * from coverage because it is not hand-written, but it is imported by the apps
 * exactly like the rest of the package, so an import-time throw there breaks a
 * device just as completely.
 */
const modules = collectModules(srcDir)
  .map((file) => `../src/${relative(srcDir, file).split(sep).join('/')}`)
  .sort()

describe('optional Intl APIs are never used at module-evaluation time', () => {
  const removed = new Map<string, unknown>()

  const deleteOptionalIntlApis = () => {
    const intl = Intl as unknown as Record<string, unknown>
    for (const api of OPTIONAL_INTL_APIS) {
      if (api in intl) {
        removed.set(api, intl[api])
        delete intl[api]
      }
    }
  }

  afterEach(() => {
    const intl = Intl as unknown as Record<string, unknown>
    for (const [api, value] of removed) {
      intl[api] = value
    }
    removed.clear()
    vi.resetModules()
  })

  it('has modules to check at all', () => {
    // A collector that silently walked the wrong directory would make every
    // case below vacuously pass.
    expect(modules.length).toBeGreaterThan(10)
    expect(modules).toContain('../src/index.ts')
    expect(modules).toContain('../src/contracts/http/wardrobe.ts')
  })

  it('really does remove Intl.Segmenter for these cases', () => {
    // Pins the mechanism itself: if a future Node made `Intl` non-configurable,
    // every case below would pass while proving nothing.
    deleteOptionalIntlApis()
    expect('Segmenter' in Intl).toBe(false)
  })

  it.each(modules)('imports %s without an ECMA-402 optional API', async (specifier) => {
    deleteOptionalIntlApis()
    vi.resetModules()

    await expect(import(specifier)).resolves.toBeDefined()
  })
})
