import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('every hideKeyboard in the Story 6.5 and 6.8 flows is optional, because iOS fails it when no software keyboard shows', () => {
  const offenders = []
  for (const directory of ['maestro/story65', 'maestro/story68'])
    for (const name of fs.readdirSync(path.join(root, directory)))
      if (name.endsWith('.yaml')) {
        const lines = fs
          .readFileSync(path.join(root, directory, name), 'utf8')
          .split('\n')
        lines.forEach((line, index) => {
          if (!/^\s*- hideKeyboard\b/.test(line)) return
          const block = lines.slice(index, index + 3).join('\n')
          if (!/^\s*- hideKeyboard:\s*\n\s+optional:\s*true\b/.test(block))
            offenders.push(`${directory}/${name}:${index + 1}`)
        })
      }
  assert.deepEqual(offenders, [])
})
