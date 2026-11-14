// Runs a workflow step's shell script against stub tools, so the tests can prove what a step does
// with each output a tool may give: a pass, zero tests, all skipped, a failure.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Runs one step's script with stub tools on PATH; returns the exit status. */
export function runWithStubs(row, stubs, { env = {} } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-step-'))
  try {
    const bin = path.join(scratch, 'bin')
    fs.mkdirSync(bin)
    for (const [name, body] of Object.entries(stubs)) {
      fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, {
        mode: 0o755,
      })
    }
    const cwd = path.join(scratch, row['working-directory'] ?? '.')
    fs.mkdirSync(cwd, { recursive: true })
    return spawnSync('bash', ['-c', row.run], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: scratch,
      },
    }).status
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** A stub body printing XCTest's own summary; with skips it reads "with S tests skipped and F failures". */
export const xctestSummary = (count, failures = 0, skipped = 0) =>
  `echo "Test Suite 'All tests' passed."; echo "\t Executed ${plural(count, 'test')}, with ${skipped ? `${plural(skipped, 'test')} skipped and ` : ''}${plural(failures, 'failure')} (0 unexpected) in 0.1 (0.1) seconds"; exit ${failures ? 1 : 0}`
