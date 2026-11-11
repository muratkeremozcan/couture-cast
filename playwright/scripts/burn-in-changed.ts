import { createRequire } from 'node:module'
import path from 'node:path'
import type { runBurnIn as RunBurnIn } from '@seontechnologies/playwright-utils/burn-in'
import type TypeScript from 'typescript'

/** An import that names a URL, such as k6's `https://jslib.k6.io/...` modules. */
const URL_SPECIFIER = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Makes the burn-in dependency analysis see the repository's real import graph.
 *
 * The library runs madge over the whole checkout and walks each spec's imports
 * for a changed file. Three defects decided which specs burned in:
 *
 * - URL imports crashed it. madge resolves through filing-cabinet 4.2.0, which
 *   reads `failedLookupLocations.filter` for an import it cannot resolve, and
 *   TypeScript 5 leaves that field undefined for a URL specifier. The first k6
 *   scenario importing `https://jslib.k6.io/...` threw "Cannot read properties
 *   of undefined (reading 'filter')", and burn-in fell back to percentage mode
 *   with `--only-changed`. A URL is never a file in this repository, so it now
 *   resolves to nothing, as any unresolvable import does.
 * - The walk never left the spec. madge keys its graph and lists its edges
 *   relative to the directory it ran in, and the library looks specs and their
 *   edges up as absolute paths, so only a changed spec file ever matched; a
 *   changed helper selected nothing. The graph is handed over with absolute
 *   paths, which is what the walk expects.
 * - Workspace imports led to build output. With the root tsconfig,
 *   `@couture/api-client` resolved to `packages/api-client/dist`, which a
 *   change never touches. Resolution now uses the Playwright tsconfig and its
 *   `paths` under `Bundler` resolution, as the suite itself compiles, which
 *   lands on `src` and still accepts the `.js`-suffixed NodeNext imports.
 *
 * dependency-tree and the analyzer keep their own references to filing-cabinet
 * and madge from the moment they load, so this runs before the burn-in library
 * is imported.
 */
function resolveDependencyAnalysisLikeTheSuite(): void {
  const fromRoot = createRequire(path.join(process.cwd(), 'package.json'))
  const burnIn = fromRoot.resolve('@seontechnologies/playwright-utils/burn-in')
  const madgePath = createRequire(burnIn).resolve('madge')
  const dependencyTree = createRequire(madgePath).resolve('dependency-tree')
  const cabinetPath = createRequire(dependencyTree).resolve('filing-cabinet')

  const ts = createRequire(cabinetPath)('typescript') as typeof TypeScript
  const configPath = path.join(process.cwd(), 'playwright', 'tsconfig.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    }
  )
  if (!parsed) throw new Error(`Could not read ${configPath}`)
  // filing-cabinet plucks `options` from an already parsed config.
  const tsConfig = {
    options: {
      ...parsed.options,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }

  type CabinetOptions = { partial: string; tsConfig?: unknown; tsConfigPath?: string }
  const resolve = fromRoot(cabinetPath) as ((options: CabinetOptions) => string) &
    Record<string, unknown>
  replaceModuleExports(
    fromRoot,
    cabinetPath,
    Object.assign(
      (options: CabinetOptions) =>
        URL_SPECIFIER.test(options.partial)
          ? ''
          : // No tsConfigPath: the parsed `paths` already resolve inside TypeScript.
            resolve({ ...options, tsConfig, tsConfigPath: undefined }),
      resolve
    )
  )

  type Graph = Record<string, string[]>
  type MadgeResult = { obj: () => Graph }
  const madge = fromRoot(madgePath) as ((
    target: string,
    config: unknown
  ) => Promise<MadgeResult>) &
    Record<string, unknown>
  replaceModuleExports(
    fromRoot,
    madgePath,
    Object.assign(async (target: string, config: unknown) => {
      const result = await madge(target, config)
      const baseDir = path.resolve(target)
      const relativeGraph = result.obj.bind(result)
      const absolute = (file: string) => path.resolve(baseDir, file)
      result.obj = () =>
        Object.fromEntries(
          Object.entries(relativeGraph()).map(([file, edges]) => [
            absolute(file),
            edges.map(absolute),
          ])
        )
      return result
    }, madge)
  )
}

function replaceModuleExports(
  fromRoot: NodeJS.Require,
  modulePath: string,
  exports: unknown
): void {
  const cached = fromRoot.cache[modulePath]
  if (!cached) throw new Error(`${modulePath} was not loaded`)
  cached.exports = exports
}

/**
 * Test runs one burn-in shard owns. A shard pays about 8 minutes of fixed setup (install,
 * Supabase from its image cache, the web build, the database reset), up to 10 more when
 * Supabase spends its whole start budget, and burn-in runs one worker at about 1.3 s per
 * test run (465 runs took 10.4 min on 2026-11-10). 200 runs keep the worst case under the
 * 20-minute PR job limit whatever a PR changes.
 */
export const BURN_IN_RUNS_PER_SHARD = 200
/** Runner cost cap; past it a shard runs more than its budget instead of fanning out further. */
export const BURN_IN_MAX_SHARDS = 8

export type BurnInPlan = {
  /** `targeted`: the analyzer named the specs. `fallback`: it used `--only-changed`. `none`: nothing to run. */
  mode: 'targeted' | 'fallback' | 'none'
  /** Test runs, repeats included, from `playwright test --list`. */
  runs: number
  shards: number
}

/** Shards for a run count: ceil(runs / per shard), at least 1, at most the cap. */
export function shardCount(runs: number): number {
  if (runs <= 0) return 1
  return Math.min(BURN_IN_MAX_SHARDS, Math.ceil(runs / BURN_IN_RUNS_PER_SHARD))
}

/** The plan as `key=value` lines for `$GITHUB_OUTPUT`; `shards` is the matrix list. */
export function planOutputs(result: BurnInPlan): string {
  const shards = Array.from({ length: result.shards }, (_, index) => index + 1)
  return [
    `mode=${result.mode}`,
    `runs=${result.runs}`,
    `total=${result.shards}`,
    `shards=${JSON.stringify(shards)}`,
  ].join('\n')
}

/** Reads `Total: N tests in M files` from `playwright test --list` output. */
export function listedRuns(output: string): number {
  const match = output.match(/Total: (\d+) tests? in \d+ files?/)
  if (!match) throw new Error('playwright test --list printed no total')
  return Number(match[1])
}

type Analyzer = {
  getChangedFiles: (base: string) => { all: string[] }
  analyzeTestableDependencies: (files: {
    all: string[]
  }) => Promise<{ tests: string[] | null }>
  buildCommand: (plan: { tests: string[] | null }) => string[] | null
}

/**
 * The plan the shards will run, built by the library's own analyzer so selection never
 * differs between the plan and the shards. Fallback mode already shards by percentage
 * inside its command, so it runs as one shard.
 */
async function plan(options: Parameters<typeof RunBurnIn>[0]): Promise<BurnInPlan> {
  const fromRoot = createRequire(path.join(process.cwd(), 'package.json'))
  const entry = fromRoot.resolve('@seontechnologies/playwright-utils/burn-in')
  const { BurnInRunner } = createRequire(entry)('./runner') as {
    BurnInRunner: new (options: Parameters<typeof RunBurnIn>[0]) => { analyzer: Analyzer }
  }
  const analyzer = new BurnInRunner(options).analyzer
  const changed = analyzer.getChangedFiles(options?.baseBranch ?? 'main')
  if (changed.all.length === 0) return { mode: 'none', runs: 0, shards: 1 }
  const testPlan = await analyzer.analyzeTestableDependencies(changed)
  const command = analyzer.buildCommand(testPlan)
  if (!command) return { mode: 'none', runs: 0, shards: 1 }
  if (testPlan.tests === null) return { mode: 'fallback', runs: 0, shards: 1 }
  const { execFileSync } = await import('node:child_process')
  const [bin, ...rest] = command
  const output = execFileSync(bin!, [...rest, '--list'], {
    encoding: 'utf8',
    env: { ...process.env, PW_BURN_IN: 'true', PW_SHARD: '' },
    maxBuffer: 64 * 1024 * 1024,
  })
  const runs = listedRuns(output)
  return { mode: 'targeted', runs, shards: shardCount(runs) }
}

async function main() {
  const args = process.argv.slice(2)
  const baseArg = args.find((arg) => arg.startsWith('--base-branch='))
  const shardArg = args.find((arg) => arg.startsWith('--shard='))
  const configArg = args.find((arg) => arg.startsWith('--config-path='))
  const planArg = args.find((arg) => arg.startsWith('--plan-out='))

  const options: Parameters<typeof RunBurnIn>[0] = {
    configPath: configArg
      ? configArg.split('=')[1]
      : 'playwright/config/.burn-in.config.ts',
  }

  if (baseArg) {
    options.baseBranch = baseArg.split('=')[1]
  }

  if (shardArg) {
    process.env.PW_SHARD = shardArg.split('=')[1]
  }

  resolveDependencyAnalysisLikeTheSuite()
  if (planArg) {
    const result = await plan(options)
    // Appends, so `--plan-out="$GITHUB_OUTPUT"` adds the plan to the step's outputs.
    const { appendFileSync } = await import('node:fs')
    appendFileSync(planArg.slice('--plan-out='.length), `${planOutputs(result)}\n`)
    console.log(`Burn-in plan:\n${planOutputs(result)}`)
    return
  }
  const { runBurnIn } = await import('@seontechnologies/playwright-utils/burn-in')
  await runBurnIn(options)
}

// Imported by its unit test for the pure helpers; runs only as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
