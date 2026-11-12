/**
 * Destructive Playwright cleanup runs only against the local Supabase database on its
 * configured port: config.toml's 54322 for a developer, CI's SUPABASE_DB_PORT override
 * (.github/supabase-ci-ports.env) in CI. On CI's ports, a URL for 54322 names some other
 * server and is refused, and a developer's default database stays protected from a run
 * aimed at CI's port.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { localPlaywrightDatabaseUrl } from './user-test-data'

const saved = {
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_DB_PORT: process.env.SUPABASE_DB_PORT,
}
afterEach(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})

const at = (port: number, database = 'postgres', host = '127.0.0.1') =>
  `postgresql://postgres:postgres@${host}:${port}/${database}`

function guard(databaseUrl: string, dbPort?: string) {
  process.env.DATABASE_URL = databaseUrl
  if (dbPort === undefined) delete process.env.SUPABASE_DB_PORT
  else process.env.SUPABASE_DB_PORT = dbPort
  return () => localPlaywrightDatabaseUrl()
}

describe('localPlaywrightDatabaseUrl', () => {
  it('accepts the developer stack on supabase/config.toml port 54322', () => {
    expect(guard(at(54322))().port).toBe('54322')
    expect(guard(at(54322, `tea_community_${'a'.repeat(32)}`))().port).toBe('54322')
  })

  it("accepts CI's stack on its configured port", () => {
    expect(guard(at(24322), '24322')().port).toBe('24322')
  })

  it('refuses the default port when CI configured another, and CI port locally', () => {
    expect(guard(at(54322), '24322')).toThrow(
      'Refusing destructive Playwright cleanup outside the supported local Supabase database: 127.0.0.1:54322/postgres'
    )
    expect(guard(at(24322))).toThrow(
      'Refusing destructive Playwright cleanup outside the supported local Supabase database: 127.0.0.1:24322/postgres'
    )
  })

  it('still refuses remote hosts and other databases on the right port', () => {
    expect(guard(at(54322, 'postgres', 'db.example.com'))).toThrow(/Refusing destructive/)
    expect(guard(at(54322, 'couture_cast'))).toThrow(/Refusing destructive/)
  })
})
