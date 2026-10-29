import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const roots = [scriptsDir, path.join(projectRoot, '.github/actions')]

function scriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : scriptFiles(full)
    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

/**
 * A script that runs only when it is the entry point compares process.argv[1] with
 * import.meta.url. Node reports the real path in import.meta.url, so an argv[1] that goes
 * through a symlink (macOS keeps /tmp as one) must be resolved with realpathSync, or the
 * script exits 0 having done nothing. argv[1] is absent under node -e and when a module is
 * imported from a REPL, and realpathSync would throw on it, so a presence check comes first.
 */
function entryPointChecks() {
  const checks = []
  for (const root of roots) {
    for (const file of scriptFiles(root)) {
      if (file === fileURLToPath(import.meta.url)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('process.argv[1]')) return
        const window = lines.slice(Math.max(0, index - 3), index + 4).join('\n')
        if (window.includes('import.meta.url')) {
          checks.push({
            where: `${path.relative(projectRoot, file)}:${index + 1}`,
            line,
            window,
          })
        }
      })
    }
  }
  return checks
}

describe('direct-run guards', () => {
  test('the checks are found in scripts and in the workflow actions', () => {
    const where = entryPointChecks().map((check) => check.where)
    assert.ok(where.some((item) => item.startsWith('scripts/')))
    assert.ok(where.some((item) => item.startsWith('.github/actions/')))
  })

  test('every entry-point check resolves symlinks in process.argv[1]', () => {
    const offenders = entryPointChecks()
      .filter((check) => !check.window.includes('realpathSync'))
      .map((check) => check.where)
    assert.deepEqual(offenders, [])
  })

  test('every realpathSync of process.argv[1] is preceded by a presence check', () => {
    const offenders = entryPointChecks()
      .filter(
        (check) =>
          check.window.includes('realpathSync(process.argv[1]') &&
          !/process\.argv\[1\] (&&|\?)/.test(check.window)
      )
      .map((check) => check.where)
    assert.deepEqual(offenders, [])
  })

  test('every realpathSync in an entry-point check comes from node:fs, not node:fs/promises', () => {
    const offenders = entryPointChecks()
      .filter((check) => /\bfs\.realpathSync\(/.test(check.window))
      .filter((check) => {
        const file = path.join(projectRoot, check.where.replace(/:\d+$/, ''))
        const source = fs.readFileSync(file, 'utf8')
        return !/import (fs|\* as fs) from ['"](node:)?fs['"]/.test(source)
      })
      .map((check) => check.where)
    assert.deepEqual(offenders, [])
  })

  test('importing an entry-point script where argv[1] is absent does not throw', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "import('./scripts/integration-postgres.mjs').then(() => console.log('imported'))",
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    )
    assert.match(result.stdout, /imported/, result.stderr)
  })
})
