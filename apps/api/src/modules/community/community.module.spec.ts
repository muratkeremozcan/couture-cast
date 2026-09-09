// Story 6.2: the request app's import graph is a deployment contract.
//
// Twice now the screening stack has been dragged into the serverless API by a
// provider the request path never uses, and both times every local gate stayed
// green while the deployed function died on load. This walks the graph the
// bundler walks and fails on the same edge the bundler would follow.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = path.resolve(__dirname, '../..')

/**
 * `apps/api/api/index.ts`, not `src/main.ts`. That is the file `vercel.json`
 * names under `functions`, so it is the root the bundler traces from, and
 * `src/main.ts` is never reached in a deployed environment.
 */
const entryPoint = path.resolve(srcRoot, '../api/index.ts')

/**
 * Every specifier the compiler emits a real `require` for.
 *
 * `import type` and `export type` are erased, so following them would report
 * edges the bundle does not contain: `community-moderation.telemetry.ts` takes
 * a type from the engine and would otherwise drag the whole screening stack
 * back into this graph on paper while the emitted JavaScript stays clean.
 */
function valueSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  const withFrom =
    /(?:^|\n)\s*(?:import|export)(\s+type\b)?((?:(?!\bimport\b|;)[\s\S])*?)from\s*['"]([^'"]+)['"]/g
  for (let match = withFrom.exec(source); match; match = withFrom.exec(source)) {
    if (match[1]) continue
    specifiers.push(match[3] as string)
  }

  // Side-effect imports carry no `from`; `reflect-metadata` is one.
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  for (let match = bare.exec(source); match; match = bare.exec(source)) {
    specifiers.push(match[1] as string)
  }

  return specifiers
}

/** NodeNext writes `./x.js`; the file on disk is `./x.ts`. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    base,
    path.join(base, 'index.ts'),
  ]
  return (
    candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) ?? null
  )
}

function walkFromEntryPoint(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entryPoint]

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (files.has(current)) continue
    files.add(current)

    for (const specifier of valueSpecifiers(fs.readFileSync(current, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier)
        continue
      }
      const resolved = resolveLocal(current, specifier)
      if (resolved) queue.push(resolved)
    }
  }

  return { files, packages }
}

describe('the deployed request app import graph', () => {
  const { files, packages } = walkFromEntryPoint()
  const relative = [...files].map((file) => path.relative(srcRoot, file))

  it('6.2-UNIT-041 walks a real graph, so the exclusions below are not vacuous', () => {
    // A walker that resolved nothing would satisfy every "does not contain"
    // assertion in this file while proving none of them.
    expect(relative.length).toBeGreaterThan(50)
    expect(relative).toContain('app.module.ts')
    expect(relative).toContain(path.join('modules', 'community', 'community.module.ts'))
    expect(relative).toContain(path.join('modules', 'community', 'community.service.ts'))
    expect(packages.size).toBeGreaterThan(5)
  })

  /**
   * `bad-words@4.1.5` ships CommonJS that `require()`s the ESM-only
   * `badwords-list`. Vercel bundles the function with its own CommonJS loader,
   * which refuses that and kills the function on load with `ERR_REQUIRE_ESM`,
   * so `/api/health` answered `FUNCTION_INVOCATION_FAILED` on every poll. Node
   * 24 permits `require()` of ESM, which is why the whole local gate set stayed
   * green, and the Vercel project is already on 24.x, so there is no runtime to
   * raise. Reproduce the deployed loader with
   * `node --no-experimental-require-module -e "require('apps/api/dist/api/index.js')"`.
   */
  it('6.2-UNIT-041 never reaches the text screener or bad-words', () => {
    expect(relative).not.toContain(
      path.join('modules', 'community', 'community-text-screener.ts')
    )
    expect(relative).not.toContain(
      path.join('modules', 'community', 'community-moderation.engine.ts')
    )
    expect([...packages]).not.toContain('bad-words')
  })

  /**
   * The same edge would carry roughly 98 MB of model runtime into a function
   * that cannot run inference, so this is a size guard as much as a correctness
   * one. `community-nsfw-inference.worker.ts` keeps every TensorFlow.js import
   * either `import type` or dynamic and inside a function for this reason.
   */
  it('6.2-UNIT-041 never reaches the model runtime', () => {
    const modelPackages = [...packages].filter(
      (name) => name === 'nsfwjs' || name.startsWith('@tensorflow/')
    )
    expect(modelPackages).toEqual([])
  })
})
