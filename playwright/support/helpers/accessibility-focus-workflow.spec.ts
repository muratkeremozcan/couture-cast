import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(__dirname, '../../..')
const workflow = fs.readFileSync(
  path.join(repo, '.github/workflows/pr-accessibility-focus.yml'),
  'utf8'
)

/** The `paths:` list under the `on.<trigger>` block, one quoted entry per line. */
function pathsFor(trigger: 'pull_request' | 'push'): string[] {
  const block = new RegExp(`^  ${trigger}:\\n([\\s\\S]*?)(?=^  \\S|^\\S)`, 'm').exec(
    workflow
  )?.[1]
  const list = /^ {4}paths:\n((?: {6}- .*\n)+)/m.exec(block ?? '')?.[1] ?? ''
  return list
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^ {6}- '?(.*?)'?$/, '$1'))
}

// Everything that changes what the module lane builds or runs.
const REQUIRED = [
  'apps/mobile/modules/accessibility-focus/**',
  'apps/mobile/src/lib/accessibility-focus.ts',
  'apps/mobile/src/features/home/use-home-spotlight-teaser.ts',
  'apps/mobile/components/home/home-spotlight-teaser.tsx',
  'apps/mobile/package.json',
  'apps/mobile/app.config.ts',
  'apps/mobile/app.json',
  'package-lock.json',
  'scripts/ci/android-talkback.sh',
  'scripts/ci/accessibility-focus-device-tests.sh',
  'scripts/ci/check-accessibility-focus-results.mjs',
  'scripts/ci/check-accessibility-focus-builds.sh',
  'scripts/run-story67-talkback.mjs',
  '.github/workflows/pr-accessibility-focus.yml',
]

describe('accessibility-focus workflow triggers', () => {
  it.each(['pull_request', 'push'] as const)(
    'runs on %s for every input of the module lane',
    (trigger) => {
      expect(pathsFor(trigger)).toEqual(REQUIRED)
    }
  )

  it('names only paths that exist', () => {
    for (const entry of REQUIRED) {
      const target = entry.endsWith('/**') ? entry.slice(0, -3) : entry
      expect(fs.existsSync(path.join(repo, target)), entry).toBe(true)
    }
  })
})
