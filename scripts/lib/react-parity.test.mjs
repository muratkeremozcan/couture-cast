// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'

import { reactParityProblems } from './react-parity.mjs'

const read = (relative) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'))

function repository() {
  const manifests = {}
  for (const workspace of ['apps/web', 'apps/mobile', 'apps/api']) {
    manifests[workspace] = read(`../../${workspace}/package.json`)
  }
  for (const name of fs.readdirSync(new URL('../../packages/', import.meta.url))) {
    const file = new URL(`../../packages/${name}/package.json`, import.meta.url)
    if (fs.existsSync(file))
      manifests[`packages/${name}`] = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  manifests.root = read('../../package.json')
  return { manifests, lock: read('../../package-lock.json') }
}

describe('react parity', () => {
  test('every workspace and the lockfile run one React', () => {
    assert.deepEqual(reactParityProblems(repository()), [])
  })

  const pair = (web, mobile, lock = {}) => ({
    manifests: {
      'apps/web': { dependencies: web },
      'apps/mobile': { dependencies: mobile },
    },
    lock: { packages: lock },
  })

  test('moving react in one workspace only is caught', () => {
    assert.deepEqual(
      reactParityProblems(pair({ react: '19.1.0' }, { react: '19.2.0' })),
      ['react differs: apps/web 19.1.0, apps/mobile 19.2.0']
    )
  })

  test('a react-dom or renderer behind react, a range, and stale types are caught', () => {
    assert.deepEqual(
      reactParityProblems(
        pair(
          { react: '19.2.0', 'react-dom': '19.2.0', '@types/react-dom': '18.3.7' },
          { react: '19.2.0', 'react-test-renderer': '^19.1.0', '@types/react': '19.1.17' }
        )
      ),
      [
        'apps/mobile: react-test-renderer ^19.1.0 is not an exact version',
        'apps/mobile: react-test-renderer ^19.1.0 is not react 19.2.0',
        'apps/mobile: @types/react 19.1.17 does not match react 19.2',
        'apps/web: @types/react-dom 18.3.7 does not match react 19.2',
      ]
    )
  })

  test('a lockfile that installs another version is caught', () => {
    assert.deepEqual(
      reactParityProblems(
        pair(
          { react: '19.2.0' },
          { react: '19.2.0' },
          {
            'node_modules/react': { version: '19.1.0' },
            'apps/web/node_modules/react': { version: '19.2.0' },
          }
        )
      ),
      ['lockfile node_modules/react 19.1.0 is not 19.2.0']
    )
  })
})
