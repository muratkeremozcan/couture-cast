// Every Playwright spec must load under Playwright's own transform, which compiles a script
// helper a spec imports to CommonJS. PR #211's burn-in plan went red when
// scripts/lib/local-supabase-ports.mjs used import.meta, which that transform rejects:
// `playwright test --list` printed "Cannot use 'import.meta' outside a module" for every
// spec that imports it, and listed 0 tests.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')

test('the local suite lists every spec without a load error', () => {
  // Specs import the shared packages' dist. A job may run this before it builds them
  // (browser-acceptance's harness step does), so build first, as prepare:playwright does:
  // the Prisma client before @couture/testing, which compiles against it. An unchanged
  // package is skipped (scripts/build-workspace-package.mjs).
  for (const script of ['db:generate', 'build:packages']) {
    const built = spawnSync('npm', ['run', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 300_000,
    })
    assert.equal(built.status, 0, `${script}\n${built.stdout}\n${built.stderr}`)
  }
  const listed = spawnSync(process.execPath, [cli, 'test', '--list'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TEST_ENV: 'local', PLAYWRIGHT_SKIP_DB_RESET: 'true' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  })
  assert.doesNotMatch(listed.stderr + listed.stdout, /SyntaxError|Error: /)
  assert.equal(listed.status, 0, listed.stderr)
  const total = /Total: (\d+) tests? in (\d+) files?/.exec(listed.stdout)
  assert.ok(total && Number(total[2]) > 40, `listed ${total?.[0] ?? 'nothing'}`)
})
