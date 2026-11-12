#!/usr/bin/env node
// The last step of `prepare:playwright`: the Playwright helper unit tests, so a local Playwright
// run checks its helpers first. In CI the playwright-unit job of pr-checks.yml runs them once per
// push, whenever a file they read changes, and the workflows that run Playwright beside it set
// PLAYWRIGHT_UNIT_LANE so each Playwright job does not run them again.
import { spawnSync } from 'node:child_process'

if (process.env.PLAYWRIGHT_UNIT_LANE) {
  console.log(
    'PLAYWRIGHT_UNIT_LANE is set: the playwright-unit job in pr-checks.yml runs the helper unit tests.'
  )
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const run = spawnSync(npm, ['run', 'test:playwright-unit'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
}
