import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  BROWSERS,
  WEB_MATRIX_SUMMARY_FILE,
  expectedWebMatrix,
} from './assert-web-matrix.mjs'
import { passingReport } from './web-matrix-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const expected = expectedWebMatrix()
const perBrowser =
  expected.perLocale.length * expected.locales.length + expected.shared.length
// The browser-acceptance job's projector step runs with these.
const ciEnv = {
  CC68_CI_PLATFORM: 'android',
  CC68_CI_API: '36',
  CC68_CI_JOB_STATUS: 'success',
}
const SECRET = 'eyJhbGciOiJub25lIn0.cc68-private-payload.signature'

function runtime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-public-evidence-'))
  return { directory, upload: path.join(directory, 'public-evidence') }
}
function run(script, directory, env = {}) {
  const { CC68_CI_PLATFORM, CC68_CI_API, CC68_CI_JOB_STATUS, ...inherited } = process.env
  void [CC68_CI_PLATFORM, CC68_CI_API, CC68_CI_JOB_STATUS]
  return spawnSync(process.execPath, [path.join(here, script)], {
    env: { ...inherited, CC68_HARNESS_DIR: directory, ...env },
    encoding: 'utf8',
  })
}
const write = (directory, name, content) =>
  fs.writeFileSync(
    path.join(directory, name),
    typeof content === 'string' ? content : JSON.stringify(content)
  )
const listing = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory) : [])
/** The producer's success path: a genuine all-passing report through assert-web-matrix. */
function produce(directory) {
  write(directory, 'playwright-web-matrix.json', passingReport(expected))
  const produced = run('assert-web-matrix.mjs', directory)
  assert.equal(produced.status, 0, produced.stderr)
}
/** Everything a real runtime holds next to the summary that must never be uploaded. */
function plantUnapprovedData(directory, upload) {
  write(directory, 'owned-env.json', { SUPABASE_SERVICE_ROLE_KEY: SECRET })
  write(directory, 'session-primary.json', { access_token: SECRET })
  write(directory, 'api.log', `Authorization: Bearer ${SECRET}\n`)
  write(directory, 'notes.json', { unrelated: true })
  // A file a previous step left in the uploaded directory must not survive either.
  fs.mkdirSync(upload, { recursive: true })
  write(upload, 'leftover.json', { access_token: SECRET })
}

describe('browser matrix evidence from producer to upload directory', () => {
  test('the producer keeps the validated summary private and the projector uploads it', () => {
    const { directory, upload } = runtime()
    produce(directory)
    // The producer writes no upload directory of its own: only the private file.
    assert.deepEqual(listing(upload), [])
    assert.ok(fs.existsSync(path.join(directory, WEB_MATRIX_SUMMARY_FILE)))
    plantUnapprovedData(directory, upload)

    const projected = run('public-evidence.mjs', directory, ciEnv)
    assert.equal(projected.status, 0, projected.stderr)

    // Proof retained, as a closed projection of exactly the validated summary.
    assert.deepEqual(listing(upload).sort(), ['ci-job-status.json', 'web-matrix.json'])
    const summary = JSON.parse(fs.readFileSync(path.join(upload, 'web-matrix.json')))
    assert.deepEqual(summary, {
      passed: true,
      cases: perBrowser * 3,
      projects: BROWSERS.map((browser) => ({
        browser,
        passed: perBrowser,
        locales: expected.locales,
      })),
    })
    assert.equal(summary.cases, 150)
    // Unapproved data excluded: the raw report, runtime files, logs and the private file.
    for (const name of listing(upload))
      assert.ok(!fs.readFileSync(path.join(upload, name), 'utf8').includes(SECRET), name)
    for (const name of [
      'playwright-web-matrix.json',
      WEB_MATRIX_SUMMARY_FILE,
      'owned-env.json',
      'session-primary.json',
      'api.log',
      'notes.json',
      'leftover.json',
    ])
      assert.ok(!listing(upload).includes(name), name)
  })

  test('the private summary is consumed so a reused runtime cannot republish stale proof', () => {
    const { directory, upload } = runtime()
    produce(directory)
    const first = run('public-evidence.mjs', directory, ciEnv)
    assert.equal(first.status, 0, first.stderr)
    assert.ok(listing(upload).includes('web-matrix.json'))
    assert.ok(!fs.existsSync(path.join(directory, WEB_MATRIX_SUMMARY_FILE)))
    // The same runtime projected again, with no new producer run in between.
    const second = run('public-evidence.mjs', directory, ciEnv)
    assert.equal(second.status, 0, second.stderr)
    assert.deepEqual(listing(upload), ['ci-job-status.json'])
  })

  test('a refused summary is consumed too', () => {
    const { directory } = runtime()
    write(directory, WEB_MATRIX_SUMMARY_FILE, { passed: false })
    const refused = run('public-evidence.mjs', directory, ciEnv)
    assert.notEqual(refused.status, 0)
    assert.ok(!fs.existsSync(path.join(directory, WEB_MATRIX_SUMMARY_FILE)))
  })

  test('a run without a validated summary uploads no matrix proof', () => {
    const { directory, upload } = runtime()
    // The browser run failed: the producer wrote nothing, but a raw report may exist.
    write(directory, 'playwright-web-matrix.json', passingReport(expected))
    const projected = run('public-evidence.mjs', directory, ciEnv)
    assert.equal(projected.status, 0, projected.stderr)
    assert.deepEqual(listing(upload), ['ci-job-status.json'])
  })

  test('a failing run removes the summary an earlier run left behind', () => {
    const { directory } = runtime()
    produce(directory)
    const failing = passingReport(expected)
    failing.suites[0].specs[0].tests[0].status = 'unexpected'
    write(directory, 'playwright-web-matrix.json', failing)
    const produced = run('assert-web-matrix.mjs', directory)
    assert.notEqual(produced.status, 0)
    assert.ok(!fs.existsSync(path.join(directory, WEB_MATRIX_SUMMARY_FILE)))
  })

  describe('a summary outside the closed schema is refused and nothing is uploaded', () => {
    const summary = () =>
      JSON.parse(
        fs.readFileSync(path.join(runtimeWith.directory, WEB_MATRIX_SUMMARY_FILE))
      )
    let runtimeWith
    for (const [name, change] of [
      ['an extra top-level field', (value) => ({ ...value, token: SECRET })],
      [
        'an extra project field',
        (value) => ({
          ...value,
          projects: value.projects.map((project) => ({ ...project, token: SECRET })),
        }),
      ],
      ['a total that is not the matrix', (value) => ({ ...value, cases: 143 })],
      ['a failed run', (value) => ({ ...value, passed: false })],
      [
        'a missing browser',
        (value) => ({ ...value, projects: value.projects.slice(0, 2) }),
      ],
      [
        'a short browser count',
        (value) => ({
          ...value,
          projects: value.projects.map((project, index) =>
            index === 1 ? { ...project, passed: perBrowser - 1 } : project
          ),
        }),
      ],
      [
        'an unknown locale',
        (value) => ({
          ...value,
          projects: value.projects.map((project) => ({
            ...project,
            locales: [...project.locales.slice(1), 'xx-XX'],
          })),
        }),
      ],
    ]) {
      test(name, () => {
        runtimeWith = runtime()
        const { directory, upload } = runtimeWith
        produce(directory)
        write(directory, WEB_MATRIX_SUMMARY_FILE, change(summary()))
        const projected = run('public-evidence.mjs', directory, ciEnv)
        assert.notEqual(projected.status, 0)
        assert.match(projected.stderr, /invalid_web_matrix_evidence/)
        assert.ok(!projected.stderr.includes(SECRET))
        assert.deepEqual(listing(upload), [])
      })
    }

    test('unparseable content', () => {
      const { directory, upload } = runtime()
      write(directory, WEB_MATRIX_SUMMARY_FILE, `{ "token": "${SECRET}`)
      const projected = run('public-evidence.mjs', directory, ciEnv)
      assert.notEqual(projected.status, 0)
      assert.match(projected.stderr, /invalid_web_matrix_evidence/)
      assert.ok(!projected.stderr.includes(SECRET))
      assert.deepEqual(listing(upload), [])
    })
  })
})
