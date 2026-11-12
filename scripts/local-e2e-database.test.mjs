// The local database fallback reads the Supabase port from the environment it fills, at
// the time it fills it. Codex review of PR #211: a module-level URL captured the port
// before a launcher loaded .env.local, so the migration reached the other local server.
import assert from 'node:assert/strict'
import { test } from 'node:test'

const fresh = () => import(`./local-e2e-database.mjs?${Math.random()}`)

test('the fallback uses the port of the environment it fills', async () => {
  const saved = process.env.SUPABASE_DB_PORT
  // Imported while the shell exports CI's port.
  process.env.SUPABASE_DB_PORT = '24322'
  try {
    const { applyLocalE2eDatabaseUrl } = await fresh()
    // Then the launcher's env file settles the developer port.
    const env = { TEST_ENV: 'local', SUPABASE_DB_PORT: '54322' }
    assert.equal(applyLocalE2eDatabaseUrl(env), true)
    assert.equal(
      env.DATABASE_URL,
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    )
  } finally {
    if (saved === undefined) delete process.env.SUPABASE_DB_PORT
    else process.env.SUPABASE_DB_PORT = saved
  }
})

test('an environment with no override falls back to supabase/config.toml', async () => {
  const saved = process.env.SUPABASE_DB_PORT
  process.env.SUPABASE_DB_PORT = '24322'
  try {
    const { applyLocalE2eDatabaseUrl } = await fresh()
    const env = { NODE_ENV: 'test' }
    applyLocalE2eDatabaseUrl(env)
    assert.equal(
      env.DATABASE_URL,
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    )
  } finally {
    if (saved === undefined) delete process.env.SUPABASE_DB_PORT
    else process.env.SUPABASE_DB_PORT = saved
  }
})
