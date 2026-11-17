// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
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

  // GitHub runs `run:` under `bash -e`, and a ( ... ) & subshell inherits -e: a service that
  // exited non-zero ended its subshell before the echo, so only a clean exit was ever recorded.
  // Run 44145335277 (PR 252, browser-acceptance) lost its crashed auth proxy this way: no exit
  // file, so the web build waited its full 120 s and reported a timeout.
  const launches = [
    '.github/workflows/pr-share-card-native.yml',
    '.github/workflows/ios-native-jobs.yml',
  ].flatMap((workflow) =>
    Object.entries(parse(fs.readFileSync(workflow, 'utf8')).jobs).flatMap(([job, spec]) =>
      (spec.steps ?? []).flatMap((step) =>
        (step.run ?? '')
          .split('\n')
          .filter((row) => /\/tmp\/cc68-\w+\.exit\) &$/.test(row.trim()))
          .map((row) => ({ where: `${workflow} ${job}`, row: row.trim() }))
      )
    )
  )

  test('every job that starts the owned services is covered', () => {
    const perJob = {}
    for (const { where } of launches) perJob[where] = (perJob[where] ?? 0) + 1
    const share = '.github/workflows/pr-share-card-native.yml'
    const ios = '.github/workflows/ios-native-jobs.yml'
    assert.deepEqual(perJob, {
      [`${share} original-resource`]: 3,
      [`${share} android36-native-matrix`]: 3,
      [`${share} android36-original`]: 3,
      [`${share} android36-controls`]: 3,
      [`${share} android36-interaction`]: 3,
      [`${share} android36-release-font`]: 3,
      [`${share} browser-acceptance`]: 2,
      [`${ios} ios-build`]: 3,
      [`${ios} ios-shard`]: 3,
      [`${ios} ios-expo-go`]: 3,
      [`${ios} ios-live-font`]: 3,
    })
  })

  for (const status of [0, 7])
    test(`every launch records exit status ${status} under the runner's bash -e`, () => {
      for (const { where, row } of launches) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-launch-'))
        try {
          const line = row
            .replaceAll('/tmp/cc68-', `${directory}/cc68-`)
            .replaceAll(/\$\{\{[^}]*\}\}/g, 'android')
          const service = /cc68-(\w+)\.exit/.exec(line)[1]
          // `node` stands in for the service: it exits with `status` at once.
          const result = spawnSync(
            'bash',
            ['-e', '-c', `node() { return ${status}; }\n${line}\nwait`],
            { encoding: 'utf8' }
          )
          assert.equal(result.status, 0, `${where}: ${result.stderr}`)
          assert.equal(
            fs.readFileSync(path.join(directory, `cc68-${service}.exit`), 'utf8'),
            `${status}\n`,
            `${where}: ${row}`
          )
        } finally {
          fs.rmSync(directory, { recursive: true, force: true })
        }
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
