import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AUTH_OTP_ROW_LIMIT,
  authOtpRows,
  validAuthOtpRows,
} from './story68-auth-otp-observations.mjs'

const reader = (value) => () => JSON.stringify(value)

describe('authOtpRows', () => {
  test('keeps only code requests seen since the flow began, as closed values', () => {
    const rows = authOtpRows({
      directory: '/owned',
      since: 1000,
      read: reader([
        { path: '/auth/v1/otp', mode: 'owned-admin-generateLink', status: 200, at: 900 },
        { path: '/auth/v1/token', mode: 'real-local-auth', status: 200, at: 1500 },
        {
          path: '/auth/v1/otp',
          mode: 'owned-admin-generateLink',
          status: 200,
          at: 4200,
          email: 'must not cross',
        },
        { path: '/auth/v1/otp', mode: 'harness-error', status: 503, at: 9000 },
      ]),
    })
    assert.deepEqual(rows, [
      { mode: 'owned-admin-generateLink', status: 200, afterMs: 3200 },
      { mode: 'harness-error', status: 503, afterMs: 8000 },
    ])
    assert.equal(validAuthOtpRows(rows), true)
  })

  test('an unknown mode, a bad status or an untimed row is dropped', () => {
    assert.deepEqual(
      authOtpRows({
        directory: '/owned',
        since: 0,
        read: reader([
          { path: '/auth/v1/otp', mode: 'free text', status: 200, at: 1 },
          { path: '/auth/v1/otp', mode: 'real-local-auth', status: 99, at: 1 },
          { path: '/auth/v1/otp', mode: 'real-local-auth', status: 200 },
        ]),
      }),
      []
    )
  })

  test('a missing or unreadable record, or no flow start, yields no rows', () => {
    assert.deepEqual(
      authOtpRows({
        directory: '/owned',
        since: 0,
        read: () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
      }),
      []
    )
    assert.deepEqual(authOtpRows({ directory: '/owned', since: 0, read: () => '{' }), [])
    assert.deepEqual(
      authOtpRows({ directory: '/owned', since: null, read: reader([]) }),
      []
    )
  })

  test('only the last rows are kept', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      path: '/auth/v1/otp',
      mode: 'owned-admin-generateLink',
      status: 200,
      at: index,
    }))
    const rows = authOtpRows({ directory: '/owned', since: 0, read: reader(many) })
    assert.equal(rows.length, AUTH_OTP_ROW_LIMIT)
    assert.equal(rows.at(-1).afterMs, 19)
  })
})

test('a held request shows as received with no answer', () => {
  const rows = authOtpRows({
    directory: '/owned',
    since: 0,
    read: reader([
      { path: '/auth/v1/otp', mode: 'request-received', status: null, at: 40 },
      { path: '/auth/v1/otp', mode: 'request-received', status: 200, at: 41 },
      { path: '/auth/v1/otp', mode: 'owned-admin-generateLink', status: null, at: 42 },
    ]),
  })
  assert.deepEqual(rows, [{ mode: 'request-received', status: null, afterMs: 40 }])
  assert.equal(validAuthOtpRows(rows), true)
})

describe('validAuthOtpRows', () => {
  test('rejects an extra key, an open mode and too many rows', () => {
    const row = { mode: 'real-local-auth', status: 200, afterMs: 5 }
    assert.equal(validAuthOtpRows([row]), true)
    assert.equal(validAuthOtpRows([{ ...row, email: 'x' }]), false)
    assert.equal(validAuthOtpRows([{ ...row, mode: 'anything' }]), false)
    assert.equal(validAuthOtpRows(Array(AUTH_OTP_ROW_LIMIT + 1).fill(row)), false)
    assert.equal(validAuthOtpRows(undefined), false)
  })
})
