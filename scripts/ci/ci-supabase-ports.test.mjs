import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import {
  ciSupabaseEnv,
  configPortKeys,
  EPHEMERAL_FLOOR,
  PORT_OVERRIDES,
} from './ci-supabase-ports.mjs'

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8')
const config = read('supabase/config.toml')
const ports = read('.github/supabase-ci-ports.env')

describe('CI Supabase ports', () => {
  test('every port supabase/config.toml assigns has a CI override', () => {
    const keys = configPortKeys(config)
    assert.ok(keys.includes('db.port') && keys.includes('api.port'), keys.join(','))
    for (const key of keys)
      assert.ok(PORT_OVERRIDES[key], `${key} has no override variable`)
  })

  test('the checked-in ports export with their URLs, all below every ephemeral range', () => {
    const lines = ciSupabaseEnv(ports, config)
    const values = Object.fromEntries(
      lines.map((line) => line.split(/=(.*)/s).slice(0, 2))
    )
    for (const name of Object.values(PORT_OVERRIDES)) {
      const port = Number(values[name])
      assert.ok(port >= 1024 && port < EPHEMERAL_FLOOR, `${name}=${values[name]}`)
    }
    assert.equal(
      values.LOCAL_DATABASE_URL,
      `postgresql://postgres:postgres@127.0.0.1:${values.SUPABASE_DB_PORT}/postgres`
    )
    assert.equal(
      values.SUPABASE_LOCAL_API_URL,
      `http://127.0.0.1:${values.SUPABASE_API_PORT}`
    )
    assert.equal(
      values.SUPABASE_LOCAL_MAILPIT_URL,
      `http://127.0.0.1:${values.SUPABASE_INBUCKET_PORT}`
    )
    assert.equal(values.DATABASE_URL, undefined)
    assert.equal(
      Object.fromEntries(
        ciSupabaseEnv(ports, config, { databaseUrl: true }).map((line) =>
          line.split(/=(.*)/s)
        )
      ).DATABASE_URL,
      values.LOCAL_DATABASE_URL
    )
  })

  test('a port inside an ephemeral range fails, naming it', () => {
    for (const port of ['54322', '32768', '49152'])
      assert.throws(
        () =>
          ciSupabaseEnv(
            ports.replace(/SUPABASE_DB_PORT=\d+/, `SUPABASE_DB_PORT=${port}`),
            config
          ),
        new RegExp(`SUPABASE_DB_PORT=${port} must be a port from 1024 to 32767`)
      )
  })

  test('a config.toml port without an override fails', () => {
    assert.throws(
      () => ciSupabaseEnv(ports.replace(/^SUPABASE_INBUCKET_PORT=.*$/m, ''), config),
      /ports without a CI override: inbucket\.port/
    )
    assert.throws(
      () => ciSupabaseEnv(ports, `${config}\n[edge_runtime]\nport = 8083\n`),
      /ports without a CI override: edge_runtime\.port/
    )
  })

  test('two overrides on one port, or a key that overrides nothing, fail', () => {
    assert.throws(
      () =>
        ciSupabaseEnv(
          ports.replace(/SUPABASE_API_PORT=\d+/, 'SUPABASE_API_PORT=24322'),
          config
        ),
      /both use 24322/
    )
    assert.throws(
      () => ciSupabaseEnv(`${ports}\nSUPABASE_FOO_PORT=24400\n`, config),
      /SUPABASE_FOO_PORT overrides no supabase\/config.toml port/
    )
  })
})
