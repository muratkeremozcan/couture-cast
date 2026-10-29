import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

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
 * script exits 0 having done nothing.
 */
describe('direct-run guards', () => {
  test('every entry-point check resolves symlinks in process.argv[1]', () => {
    const offenders = []
    for (const file of scriptFiles(scriptsDir)) {
      if (file === fileURLToPath(import.meta.url)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('process.argv[1]')) return
        const window = lines.slice(Math.max(0, index - 3), index + 4).join('\n')
        if (window.includes('import.meta.url') && !window.includes('realpathSync')) {
          offenders.push(`${path.relative(scriptsDir, file)}:${index + 1}`)
        }
      })
    }
    assert.deepEqual(offenders, [])
  })
})
