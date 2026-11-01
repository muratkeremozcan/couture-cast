import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import {
  DATABASE_CA_PATH,
  DatabaseTlsRefusedError,
  withVerifiedDatabaseTls,
} from './database-tls.mjs'

const TRANSACTION =
  'postgresql://postgres.abcref:p%40ss@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5'
const SESSION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
const CA = '/srv/certs/supabase-root-2021-ca.pem'
const exists = (candidate) => candidate === CA

describe('withVerifiedDatabaseTls', () => {
  test('names the committed CA, which exists', () => {
    assert.match(DATABASE_CA_PATH, /apps\/api\/certs\/supabase-root-2021-ca\.pem$/)
    assert.match(fs.readFileSync(DATABASE_CA_PATH, 'utf8'), /BEGIN CERTIFICATE/)
    assert.equal(
      withVerifiedDatabaseTls(SESSION),
      `${SESSION}?sslmode=require&sslcert=${DATABASE_CA_PATH}&sslaccept=strict`
    )
  })

  test('keeps the pgbouncer parameters and the credentials byte for byte', () => {
    assert.equal(
      withVerifiedDatabaseTls(TRANSACTION, { caPath: CA, fileExists: exists }),
      `${TRANSACTION}&sslcert=${CA}&sslaccept=strict`
    )
  })

  test('upgrades a weaker sslmode and sslaccept in place', () => {
    assert.equal(
      withVerifiedDatabaseTls(
        `${SESSION}?sslaccept=accept_invalid_certs&sslmode=prefer`,
        {
          caPath: CA,
          fileExists: exists,
        }
      ),
      `${SESSION}?sslaccept=strict&sslmode=require&sslcert=${CA}`
    )
  })

  test('returns an already verified URL unchanged', () => {
    const url = `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict`
    assert.equal(withVerifiedDatabaseTls(url, { fileExists: exists }), url)
  })

  test('leaves local hosts alone', () => {
    for (const host of [
      '127.0.0.1:54322',
      'localhost',
      '[::1]:5432',
      'host.docker.internal',
    ])
      assert.equal(
        withVerifiedDatabaseTls(`postgresql://u:p@${host}/db`),
        `postgresql://u:p@${host}/db`
      )
  })

  test('refuses when the CA is missing or the URL does not parse', () => {
    assert.throws(
      () => withVerifiedDatabaseTls(SESSION, { caPath: CA, fileExists: () => false }),
      DatabaseTlsRefusedError
    )
    assert.throws(() => withVerifiedDatabaseTls('not a url'), DatabaseTlsRefusedError)
  })
})
