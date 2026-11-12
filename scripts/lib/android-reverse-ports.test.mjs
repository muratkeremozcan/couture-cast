// Native lanes reverse the local Supabase API port into the emulator, because signed
// community image URLs point at it. In CI that port is SUPABASE_API_PORT from
// .github/supabase-ci-ports.env. Codex review of PR #211: two runners still reversed the
// literal 54321, so a share-card Android run loaded images from an unmapped port.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { androidReversePorts } from './story68-native-safety.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the reversed Supabase port is the configured API port', () => {
  assert.deepEqual(
    androidReversePorts([4088, 53068], { SUPABASE_API_PORT: '24321' }),
    [4088, 53068, 24321]
  )
  assert.deepEqual(androidReversePorts([4077], {}), [4077, 54321])
})

test('no native runner reverses a literal Supabase port', () => {
  const files = execFileSync(
    'git',
    ['grep', '-ilE', 'reverse', '--', 'scripts/*.mjs', 'scripts/lib/*.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
    .trim()
    .split('\n')
    .filter((file) => !file.endsWith('.test.mjs') && !file.includes('fixtures'))
  const literal = []
  for (const file of files)
    for (const [index, line] of readFileSync(path.join(root, file), 'utf8')
      .split('\n')
      .entries())
      if (/\b5432\d\b/.test(line) && !/^\s*(\/\/|\*)/.test(line))
        literal.push(`${file}:${index + 1}: ${line.trim()}`)
  assert.deepEqual(literal, [])
})
