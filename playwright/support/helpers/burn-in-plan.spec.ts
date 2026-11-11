import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BURN_IN_MAX_SHARDS,
  BURN_IN_RUNS_PER_SHARD,
  listedRuns,
  planOutputs,
  shardCommand,
  shardCount,
  workspaceSources,
} from '../../scripts/burn-in-changed'

// The burn-in matrix is sized from the plan, so a PR that changes many specs fans out
// instead of running past the 20-minute PR job limit in one job.
describe('burn-in plan sizing', () => {
  it('sizes one shard per budget of test runs, at least one and at most the cap', () => {
    expect(BURN_IN_RUNS_PER_SHARD).toBe(200)
    expect(shardCount(0)).toBe(1)
    expect(shardCount(1)).toBe(1)
    expect(shardCount(200)).toBe(1)
    expect(shardCount(201)).toBe(2)
    expect(shardCount(465)).toBe(3)
    expect(shardCount(1_600)).toBe(8)
    expect(shardCount(10_000)).toBe(BURN_IN_MAX_SHARDS)
  })

  it('reads the run count from playwright --list, repeats included', () => {
    expect(
      listedRuns('  [chromium] › a.spec.ts:1:1 › x\nTotal: 465 tests in 22 files\n')
    ).toBe(465)
    expect(listedRuns('Total: 1 test in 1 file')).toBe(1)
    expect(() => listedRuns('no tests found')).toThrow('printed no total')
  })

  it('writes the plan as step outputs with the matrix list of shard numbers', () => {
    expect(planOutputs({ mode: 'targeted', runs: 465, shards: 3 })).toBe(
      'mode=targeted\nruns=465\ntotal=3\nshards=[1,2,3]'
    )
    expect(planOutputs({ mode: 'fallback', runs: 0, shards: 1 })).toBe(
      'mode=fallback\nruns=0\ntotal=1\nshards=[1]'
    )
  })

  it('runs one shard with its own --shard in place of the library one, and the Action arguments last', () => {
    const command = [
      'test',
      '^/repo/a\\.spec\\.ts$',
      '--shard=1/1',
      '--repeat-each=3',
      '--retries=0',
    ]
    expect(shardCommand(command, '2/3', ' --add-reporter=/tmp/psp/reporter.js ')).toEqual(
      [
        'test',
        '^/repo/a\\.spec\\.ts$',
        '--repeat-each=3',
        '--retries=0',
        '--shard=2/3',
        '--add-reporter=/tmp/psp/reporter.js',
      ]
    )
    // No history or the Action skipped: PSP_ARGS is empty and Playwright's own --shard splits.
    expect(shardCommand(command, '1/1', '')).toEqual([
      'test',
      '^/repo/a\\.spec\\.ts$',
      '--repeat-each=3',
      '--retries=0',
      '--shard=1/1',
    ])
    expect(shardCommand(command, '1/2')).toContain('--shard=1/2')
  })

  it('follows a workspace build output back to the sources a change touches', () => {
    const root = path.resolve(__dirname, '../../..')
    const at = (file: string) => path.join(root, file)
    expect(workspaceSources(at('packages/utils/dist/index.js'), root)).toEqual([
      at('packages/utils/src/index.ts'),
    ])
    expect(workspaceSources(at('packages/config/dist/index.d.ts'), root)).toEqual([
      at('packages/config/src/index.ts'),
    ])
    expect(workspaceSources(at('packages/utils/src/index.ts'), root)).toEqual([])
    expect(workspaceSources(at('playwright/support/helpers/api-test.ts'), root)).toEqual(
      []
    )
  })
})
