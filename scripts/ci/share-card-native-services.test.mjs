import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { parse } from 'yaml'

const steps = parse(fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8'))
  .jobs['original-resource'].steps
const services = { auth: 'e2e-share-card/auth.mjs', api: 'serve', metro: 'metro' }

describe('owned background services in native CI', () => {
  test('every long-running service records its own exit status', () => {
    const prepare = steps.find(
      (step) => step.name === 'Prepare isolated UUID runtime and built renderer'
    )
    for (const [service, marker] of Object.entries(services)) {
      const line = prepare.run.split('\n').find((row) => row.includes(marker))
      assert.ok(
        line.includes(
          `> /tmp/cc68-${service}.log 2>&1; echo $? > /tmp/cc68-${service}.exit) &`
        ),
        line
      )
    }
  })

  for (const [name, exited, expected] of [
    ['all running', {}, 0],
    ['api crashed', { api: '1' }, 1],
  ])
    test(`the always-run report fails only when a service exited early: ${name}`, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-services-'))
      try {
        const report = steps.findIndex(
          (step) => step.name === 'Report owned background service exits'
        )
        assert.equal(steps[report].if, 'always()')
        assert.ok(
          report <
            steps.findIndex((step) => step.name === 'Select and scan closed evidence')
        )
        for (const service of Object.keys(services))
          fs.writeFileSync(path.join(directory, `cc68-${service}.log`), 'one\ntwo\n')
        for (const [service, status] of Object.entries(exited))
          fs.writeFileSync(path.join(directory, `cc68-${service}.exit`), `${status}\n`)
        const result = spawnSync(
          'bash',
          ['-c', steps[report].run.replaceAll('/tmp/cc68-', `${directory}/cc68-`)],
          { encoding: 'utf8' }
        )
        assert.equal(result.status, expected, result.stderr)
        if (expected)
          assert.match(
            result.stdout,
            /::error::owned api service exited early with status 1; its private log has +2 lines/
          )
        assert.equal(result.stdout.includes('one'), false)
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    })
})
