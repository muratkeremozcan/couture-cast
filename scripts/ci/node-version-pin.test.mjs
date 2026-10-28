import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const yamlFiles = (directory) =>
  fs
    .readdirSync(path.join(root, directory), { recursive: true })
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => path.join(directory, name))

describe('one Node release on every runner', () => {
  // A major-only .nvmrc let each runner's tool cache pick its own 24.x: macOS ran
  // 24.19.0, whose test events lack entryFile, while Linux ran 24.22.1.
  test('.nvmrc names an exact release', () => {
    assert.match(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8'), /^\d+\.\d+\.\d+\n$/)
  })

  test('every setup-node step resolves its version from .nvmrc', () => {
    let setups = 0
    for (const file of [
      ...yamlFiles('.github/workflows'),
      ...yamlFiles('.github/actions'),
    ]) {
      const document = parse(fs.readFileSync(path.join(root, file), 'utf8'))
      const sequences = [
        ...Object.values(document?.jobs ?? {}).map((job) => job.steps ?? []),
        document?.runs?.steps ?? [],
      ]
      for (const steps of sequences) {
        const pinned = (step) => {
          const source = step.with?.['node-version-file']
          const input = /^\$\{\{ inputs\.([\w-]+) \}\}$/.exec(source ?? '')?.[1]
          if ((input ? document.inputs?.[input]?.default : source) === '.nvmrc')
            return true
          return (
            step.with?.['node-version'] === '${{ env.NODE_VERSION }}' &&
            steps.some((row) => row.run?.includes('NODE_VERSION=$(cat .nvmrc)'))
          )
        }
        for (const [index, step] of steps.entries()) {
          if (!step.uses?.startsWith('actions/setup-node@')) continue
          setups++
          // A bare setup-node is harmless only when a pinned one follows it.
          const bare = !step.with?.['node-version'] && !step.with?.['node-version-file']
          assert.ok(
            pinned(step) ||
              (bare &&
                steps
                  .slice(index + 1)
                  .some(
                    (row) => row.uses?.startsWith('actions/setup-node@') && pinned(row)
                  )),
            `${file}: ${JSON.stringify(step.with ?? {})}`
          )
        }
      }
    }
    assert.ok(setups > 0)
  })
})
