import assert from 'node:assert/strict'
import test from 'node:test'
import { ownedRedisContainer, planRedis, resolveSupabase } from './runtime-sources.mjs'

const lane = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'lane-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'lane-service',
}
const status = {
  API_URL: 'http://127.0.0.1:54321',
  ANON_KEY: 'status-anon',
  SERVICE_ROLE_KEY: 'status-service',
}

test('lane-provided Supabase credentials are used without reading supabase status', () => {
  const resolved = resolveSupabase(lane, () => assert.fail('supabase status was read'))
  assert.equal(resolved.source, 'environment')
  assert.deepEqual(resolved.credentials, lane)
})

test('without lane credentials supabase status provides them', () => {
  let reads = 0
  const resolved = resolveSupabase({}, () => {
    reads += 1
    return status
  })
  assert.equal(reads, 1)
  assert.equal(resolved.source, 'supabase-status')
  assert.deepEqual(resolved.credentials, {
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  })
})

test('a partial lane set falls back whole to supabase status, never mixed', () => {
  for (const missing of Object.keys(lane)) {
    const partial = { ...lane, [missing]: '' }
    const resolved = resolveSupabase(partial, () => status)
    assert.equal(resolved.source, 'supabase-status', missing)
    assert.equal(resolved.credentials.SUPABASE_ANON_KEY, 'status-anon', missing)
  }
})

test('Supabase credentials must be complete and loopback from either source', () => {
  assert.throws(
    () => resolveSupabase({}, () => ({ ...status, SERVICE_ROLE_KEY: undefined })),
    /credentials unavailable/
  )
  assert.throws(
    () =>
      resolveSupabase(
        { ...lane, SUPABASE_URL: 'https://project.supabase.co' },
        () => status
      ),
    /loopback/
  )
  assert.throws(
    () => resolveSupabase({}, () => ({ ...status, API_URL: 'http://10.0.0.2:54321' })),
    /loopback/
  )
})

test('a lane REDIS_URL is used and nothing is owned', () => {
  assert.deepEqual(planRedis({ REDIS_URL: 'redis://127.0.0.1:6400' }), {
    owned: false,
    url: 'redis://127.0.0.1:6400',
  })
  assert.throws(() => planRedis({ REDIS_URL: 'redis://cache.example:6379' }), /loopback/)
  assert.throws(() => planRedis({ REDIS_URL: 'http://127.0.0.1:6379' }), /redis:\/\//)
})

test('without a lane REDIS_URL the runtime owns a freshly named container', () => {
  assert.deepEqual(
    planRedis({}, () => '0a1b2c3d'),
    {
      owned: true,
      container: 'cc68-runtime-redis-0a1b2c3d',
    }
  )
  assert.match(planRedis({}).container, /^cc68-runtime-redis-[a-f0-9]{8}$/)
})

test('cleanup removes only a recorded owned container', () => {
  assert.equal(ownedRedisContainer({ redisContainer: null }), null)
  assert.equal(ownedRedisContainer({}), null)
  assert.equal(
    ownedRedisContainer({ redisContainer: 'cc68-runtime-redis-0a1b2c3d' }),
    'cc68-runtime-redis-0a1b2c3d'
  )
  assert.throws(
    () => ownedRedisContainer({ redisContainer: 'supabase_db_couture-cast' }),
    /owned_redis_required/
  )
})
