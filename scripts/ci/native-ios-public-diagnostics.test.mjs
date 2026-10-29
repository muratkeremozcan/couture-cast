import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  NEVER_PUBLISHED_DIAGNOSTICS,
  PUBLIC_DIAGNOSTIC_FILES,
  closedValueProblem,
  selectPublicDiagnostics,
} from './native-ios-public-diagnostics.mjs'

const directory = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-public-diag-'))
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
  return dir
}

describe('closed values for public iOS diagnostics', () => {
  test('numbers, booleans, null, plain names and nested records are closed', () => {
    assert.equal(
      closedValueProblem({
        flow: 'maestro/story65/signin-verify.yaml',
        ms: [81167, 3.5],
        passed: true,
        next: null,
        phase: { name: 'request_completed', status: 200 },
      }),
      null
    )
  })

  for (const [title, value, reason] of [
    [
      'a device identifier',
      { device: '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB' },
      'identifier_in_string',
    ],
    ['a local path', { file: '/Users/runner/work/app/data.json' }, 'path_in_string'],
    ['a home relative path', { file: '~/Library/Keys' }, 'path_in_string'],
    ['a temp path inside text', { note: 'wrote /tmp/cc68-metro.log' }, 'path_in_string'],
    [
      'a JWT',
      { token: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl' },
      'secret_shaped_string',
    ],
    ['a key name in text', { text: 'service_role key' }, 'secret_shaped_string'],
    ['a long opaque token', { value: 'a'.repeat(45) }, 'token_shaped_string'],
    ['an email', { who: 'someone@example.org' }, 'email_in_string'],
    ['a long string', { text: 'x '.repeat(120) }, 'string_too_long'],
    ['a control character', { text: 'a\u0000b' }, 'non_printable_string'],
    [
      'a key that is a device id',
      { '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB': 1 },
      'unsafe_key',
    ],
    ['a key with a path', { '/tmp/x': 1 }, 'unsafe_key'],
    ['a non finite number', { n: Number.POSITIVE_INFINITY }, 'non_finite_number'],
  ])
    test(`${title} is not closed`, () => {
      assert.equal(closedValueProblem(value), reason)
    })

  test('a record nested too deeply or with too many entries is not closed', () => {
    let deep = 1
    for (let n = 0; n < 12; n++) deep = { next: deep }
    assert.equal(closedValueProblem(deep), 'too_deep')
    assert.equal(
      closedValueProblem(Array.from({ length: 20_001 }, () => 1)),
      'too_many_entries'
    )
  })
})

describe('selecting public iOS diagnostics', () => {
  test('closed records are published and others are named with a reason, never copied', () => {
    const dir = directory({
      'native-ios-flow-progress.json': { flows: [{ flow: 'a.yaml', ms: 10 }] },
      'native-ios-log-counts.json': { udid: '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB' },
      'native-ios-preflight.json': { path: '/Users/runner/x' },
    })
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.deepEqual([...published.keys()], ['native-ios-flow-progress.json'])
    assert.deepEqual(omitted, [
      { name: 'native-ios-preflight.json', reason: 'path_in_string' },
      { name: 'native-ios-log-counts.json', reason: 'identifier_in_string' },
    ])
    assert.doesNotMatch(JSON.stringify(omitted), /Users|8F3C/)
  })

  test('private and device records are never read, even when they look harmless', () => {
    const dir = directory(
      Object.fromEntries(NEVER_PUBLISHED_DIAGNOSTICS.map((name) => [name, { ok: 1 }]))
    )
    const { published, omitted } = selectPublicDiagnostics(dir)
    assert.equal(published.size, 0)
    assert.deepEqual(omitted, [])
    for (const name of NEVER_PUBLISHED_DIAGNOSTICS)
      assert.equal(PUBLIC_DIAGNOSTIC_FILES.includes(name), false, name)
  })

  test('an unreadable record is omitted as not json', () => {
    const dir = directory({})
    fs.writeFileSync(path.join(dir, 'native-ios-crashes.json'), '{nope')
    assert.deepEqual(selectPublicDiagnostics(dir).omitted, [
      { name: 'native-ios-crashes.json', reason: 'not_json' },
    ])
  })
})
