import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

async function resolveOwnedAuthId(admin, identity) {
  if (identity.authUserId) return identity.authUserId
  for (let page = 1; page <= 100; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (result.error) throw result.error
    const id = result.data.users.find((user) => user.email === identity.email)?.id
    if (id || result.data.users.length < 100) return id
  }
  throw new Error('owned_identity_lookup_exhausted')
}
async function removeOwnedIdentities(admin, directory) {
  const file = path.join(directory, 'created-identities.json')
  const identities = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : []
  for (const identity of identities) {
    if (!/^story65-real-[a-f0-9-]+@example\.test$/.test(identity.email))
      throw new Error('owned_identity_required')
    const id = await resolveOwnedAuthId(admin, identity)
    if (id) {
      const result = await admin.auth.admin.deleteUser(id)
      if (result.error) throw result.error
    }
  }
}

export async function cleanup(directory) {
  const resourceFile = path.join(directory, 'resources.json')
  if (!fs.existsSync(resourceFile)) return
  const resources = JSON.parse(fs.readFileSync(resourceFile))
  if (
    resources.owner !== 'cc68-impl' ||
    !/^tea_community_[a-f0-9]{32}$/.test(resources.database)
  )
    throw new Error('owned_runtime_required')
  const envFile = path.join(directory, 'owned-env.json')
  if (fs.existsSync(envFile)) {
    const env = JSON.parse(fs.readFileSync(envFile))
    if (new URL(env.SUPABASE_URL).hostname !== '127.0.0.1')
      throw new Error('loopback_required')
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    for (const object of resources.storageObjects) {
      if (
        object.bucket !== 'community-images' ||
        !/^community\/cc68-native-[a-f0-9-]+\/[a-f0-9-]+\.png$/.test(object.objectPath)
      )
        throw new Error('owned_object_required')
      const result = await admin.storage.from(object.bucket).remove([object.objectPath])
      if (result.error) throw result.error
    }
    await removeOwnedIdentities(admin, directory)
  }
  if (resources.redisContainer) {
    if (!/^cc68-runtime-redis-[a-f0-9]{8}$/.test(resources.redisContainer))
      throw new Error('owned_redis_required')
    execFileSync('docker', ['rm', '-f', resources.redisContainer], { stdio: 'ignore' })
  }
  const db = new pg.Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await db.connect()
  try {
    await db.query(`DROP DATABASE IF EXISTS "${resources.database}" WITH (FORCE)`)
  } finally {
    await db.end()
  }
  resources.cleanedAt = new Date().toISOString()
  fs.writeFileSync(resourceFile, JSON.stringify(resources, null, 2) + '\n', {
    mode: 0o600,
  })
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await cleanup(
    path.resolve(
      process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
    )
  )
