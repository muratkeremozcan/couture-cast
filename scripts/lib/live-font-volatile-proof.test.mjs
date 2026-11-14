// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling r48 (r46 P1 volatileProof): the capture hash list a run writes, and the commit
// check a proof's manifest sha must pass. The proof check itself is judged in
// live-font-scale-proof.test.mjs beside the residual approval it gates.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import {
  CAPTURE_HASHES,
  captureHashes,
  commitAncestor,
} from './live-font-volatile-proof.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('captureHashes', () => {
  test('lists every capture file by name with its sha256 under the run head, nothing else', () => {
    const files = {
      'community-001-cold-1.json': '{"stage":"cold"}',
      'community-005-before-1.json': '{"stage":"before"}',
      'community-005-before-1-pages.json': '[]',
      'community-005-before-1-not-restored.json': '[]',
      'community-005-before-1.png': 'png',
      'live-font-report.json': '{}',
      [CAPTURE_HASHES]: '{}',
    }
    const fs = {
      readdirSync: () => Object.keys(files),
      readFileSync: (file) => Buffer.from(files[path.basename(file)]),
    }
    const sha = 'a'.repeat(40)
    const hash = (text) => createHash('sha256').update(text).digest('hex')
    assert.deepEqual(captureHashes({ dir: '/run', sha, fs }), {
      version: 1,
      leg: 'live-font',
      sha,
      captures: {
        'community-001-cold-1': hash('{"stage":"cold"}'),
        'community-005-before-1': hash('{"stage":"before"}'),
      },
    })
  })
})

describe('commitAncestor', () => {
  test('HEAD and its parents pass; a sha that is no commit does not', () => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
    assert.equal(head.status, 0)
    const ancestor = commitAncestor(root)
    assert.equal(ancestor(head.stdout.trim()), true)
    const parent = spawnSync('git', ['rev-parse', 'HEAD~1'], {
      cwd: root,
      encoding: 'utf8',
    })
    if (parent.status === 0) assert.equal(ancestor(parent.stdout.trim()), true)
    assert.equal(ancestor('0'.repeat(40)), false)
  })
})
