import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { BurnInOptions } from '@seontechnologies/playwright-utils/burn-in'

/**
 * Burn-in for the specs a change can affect, in three modes:
 *
 * - `--plan-out=<file>` selects the specs, counts the test runs with `playwright test --list`
 *   and appends the plan to `<file>` (`$GITHUB_OUTPUT` in CI), which sizes the shard matrix.
 * - `--shard=i/n` runs one shard of that selection. The shards are split by recorded test
 *   duration: the playwright-smart-parallelization Action exports `PSP_ARGS`, and appending it
 *   adds the reporter that keeps each shard's own tests. Without `PSP_ARGS` (no history, or the
 *   Action skipped), Playwright's own `--shard` splits them.
 * - Without a shard, or when the library falls back to `--only-changed`, the library runs it.
 *
 * The library's analyzer selects the specs in every mode, so the plan and the shards agree.
 */

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

/** Reads `Total: N tests in M files` from `playwright test --list` output. */
export function listedRuns(output: string): number {
  const match = output.match(/Total: (\d+) tests? in \d+ files?/)
  if (!match) throw new Error('playwright test --list printed no total')
  return Number(match[1])
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

/**
 * The Playwright arguments of one shard: the library's command with this shard in place of its
 * `--shard=1/1`, then the Action's arguments, last, as the Action requires.
 */
export function shardCommand(command: string[], shard: string, pspArgs = ''): string[] {
  return [
    ...command.filter((argument) => !argument.startsWith('--shard=')),
    `--shard=${shard}`,
    ...pspArgs.split(/\s+/).filter(Boolean),
  ]
}

type Analyzer = {
  getChangedFiles: (base: string) => { all: string[] }
  analyzeTestableDependencies: (files: {
    all: string[]
  }) => Promise<{ tests: string[] | null; reason: string }>
  buildCommand: (plan: { tests: string[] | null }) => string[] | null
}

/**
 * The workspace sources behind a build output the resolver landed on. Workspace packages export
 * `dist`, so TypeScript resolves `@couture/utils` to `packages/utils/dist/index.js`, which a
 * change never touches; the spec really depends on `packages/utils/src/index.ts`.
 */
export function workspaceSources(file: string, root: string): string[] {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const match = /^packages\/([^/]+)\/dist\/(.+?)(?:\.d)?\.(?:js|ts|mjs|cjs)$/.exec(
    relative
  )
  if (!match) return []
  const source = path.join(root, 'packages', match[1]!, 'src', match[2]!)
  return [`${source}.ts`, `${source}.tsx`].filter((candidate) => existsSync(candidate))
}

let workspaceSourcesInstalled = false

/** The library's analyzer; the package exports only `runBurnIn`, which owns it. */
function analyzer(options: BurnInOptions): Analyzer {
  const fromRoot = createRequire(path.join(process.cwd(), 'package.json'))
  const entry = fromRoot.resolve('@seontechnologies/playwright-utils/burn-in')
  const fromEntry = createRequire(entry)
  if (!workspaceSourcesInstalled) {
    // The analyzer creates its resolver from this class, so every walk, the fallback's too,
    // follows a workspace import into its sources.
    const { DependencyResolver } = fromEntry('./core/dependency-graph') as {
      DependencyResolver: { prototype: { getDependencies: (file: string) => string[] } }
    }
    const resolve = DependencyResolver.prototype.getDependencies
    DependencyResolver.prototype.getDependencies = function (file: string) {
      const dependencies = resolve.call(this, file)
      const sources = dependencies.flatMap((dependency) =>
        workspaceSources(dependency, process.cwd())
      )
      return sources.length ? [...new Set([...dependencies, ...sources])] : dependencies
    }
    workspaceSourcesInstalled = true
  }
  const { BurnInRunner } = fromEntry('./runner') as {
    BurnInRunner: new (options: BurnInOptions) => { analyzer: Analyzer }
  }
  return new BurnInRunner(options).analyzer
}

/** The Playwright CLI the library itself runs. */
function playwrightCli(): string {
  return createRequire(path.join(process.cwd(), 'package.json')).resolve(
    '@playwright/test/cli'
  )
}

/** The selection and its Playwright arguments, or null when nothing needs to run. */
async function select(
  options: BurnInOptions
): Promise<{ tests: string[] | null; command: string[] } | null> {
  const burnIn = analyzer(options)
  const changed = burnIn.getChangedFiles(options.baseBranch ?? 'main')
  if (changed.all.length === 0) return null
  const testPlan = await burnIn.analyzeTestableDependencies(changed)
  console.log(`Burn-in selection: ${testPlan.reason}`)
  const command = burnIn.buildCommand(testPlan)
  return command ? { tests: testPlan.tests, command } : null
}

const burnInEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PW_BURN_IN: 'true' })

async function plan(options: BurnInOptions): Promise<BurnInPlan> {
  const selection = await select(options)
  if (!selection) return { mode: 'none', runs: 0, shards: 1 }
  // Fallback samples with its own `--shard` inside the command, so it runs as one shard.
  if (selection.tests === null) return { mode: 'fallback', runs: 0, shards: 1 }
  const listed = spawnSync(
    process.execPath,
    [playwrightCli(), ...selection.command, '--list'],
    { encoding: 'utf8', env: burnInEnv(), maxBuffer: 64 * 1024 * 1024 }
  )
  if (listed.error) throw listed.error
  if (listed.status !== 0)
    throw new Error(
      `playwright test --list exited with ${listed.status}\n${listed.stderr}`
    )
  const runs = listedRuns(listed.stdout)
  return { mode: 'targeted', runs, shards: shardCount(runs) }
}

async function runShard(options: BurnInOptions, shard: string): Promise<number> {
  const selection = await select(options)
  if (!selection) {
    console.log('No tests need to burn in.')
    return 0
  }
  if (selection.tests === null) {
    // The library's fallback already samples by percentage.
    const { runBurnIn } = await import('@seontechnologies/playwright-utils/burn-in')
    await runBurnIn(options)
    return 0
  }
  const args = shardCommand(selection.command, shard, process.env.PSP_ARGS)
  console.log(`Burn-in shard ${shard}: playwright ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [playwrightCli(), ...args], {
    stdio: 'inherit',
    env: burnInEnv(),
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

  const options: BurnInOptions = {
    configPath: value('config-path') ?? 'playwright/config/.burn-in.config.ts',
    baseBranch: value('base-branch'),
  }

  const planOut = value('plan-out')
  if (planOut) {
    const result = await plan(options)
    // Appends, so `--plan-out="$GITHUB_OUTPUT"` adds the plan to the step's outputs.
    appendFileSync(planOut, `${planOutputs(result)}\n`)
    console.log(`Burn-in plan:\n${planOutputs(result)}`)
    return 0
  }
  const shard = value('shard')
  if (shard) return runShard(options, shard)
  const { runBurnIn } = await import('@seontechnologies/playwright-utils/burn-in')
  await runBurnIn(options)
  return 0
}

// Imported by its unit test for the pure helpers; runs only as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(1)
    }
  )
}
