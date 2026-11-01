import fs from 'node:fs'
import { assertStory68DiskSpace } from '../lib/test-disk-space.mjs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { planRedis, resolveSupabase } from './runtime-sources.mjs'
import { pinNativeJourneyWeather } from '../lib/native-journey-weather.mjs'
import { story68PublicBuildEnv } from '../lib/story68-public-build-env.mjs'

const root = process.cwd()
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
const resourcesFile = path.join(directory, 'resources.json')
if (fs.existsSync(resourcesFile))
  throw new Error('Runtime already provisioned; inspect its owned resources.')
assertStory68DiskSpace(root)
const invocationId = randomUUID()
process.once('uncaughtException', async () => {
  try {
    const recorded = fs.existsSync(resourcesFile)
      ? JSON.parse(fs.readFileSync(resourcesFile))
      : null
    if (recorded?.invocationId === invocationId)
      await (await import('./cleanup.mjs')).cleanup(directory)
  } catch {
    console.error('Owned cleanup needs inspection of its resource manifest.')
  }
  console.error(
    'Owned runtime provisioning failed; inspect private logs and ownership manifest.'
  )
  process.exit(1)
})
const privateJson = (name, value) =>
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  })
const local = {}
loadEnv({ path: '.env.local', processEnv: local, quiet: true })
const { credentials: supabase } = resolveSupabase(process.env, () =>
  JSON.parse(
    execFileSync(
      path.join(root, 'node_modules/.bin/supabase'),
      ['status', '-o', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
  )
)
const supabaseUrl = supabase.SUPABASE_URL
const redis = planRedis(process.env)
const name = `tea_community_${randomUUID().replaceAll('-', '')}`
const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${name}`
const resources = {
  invocationId,
  owner: 'cc68-impl',
  database: name,
  createdDatabase: false,
  redisContainer: null,
  createdIdentities: [],
  storageObjects: [],
  apiPort: 4088,
  metroPort: 8089,
  authProxyPort: 53068,
}
fs.writeFileSync(resourcesFile, JSON.stringify(resources, null, 2) + '\n', {
  mode: 0o600,
  flag: 'wx',
})
const admin = new pg.Client({ connectionString: adminUrl })
await admin.connect()
await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
await admin.end()
resources.createdDatabase = true
privateJson('resources.json', resources)
const db = new pg.Client({ connectionString: databaseUrl.toString() })
await db.connect()
await db.query(`CREATE SCHEMA auth;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
    SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $fn$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;`)
await db.end()
let redisUrl
if (redis.owned) {
  // Recorded before the start, so cleanup removes a half-started container too.
  resources.redisContainer = redis.container
  privateJson('resources.json', resources)
  execFileSync(
    'docker',
    ['run', '-d', '--name', redis.container, '-p', '127.0.0.1::6379', 'redis:7-alpine'],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  const redisPort = execFileSync('docker', ['port', redis.container, '6379/tcp'], {
    encoding: 'utf8',
  })
    .trim()
    .split(':')
    .at(-1)
  redisUrl = `redis://127.0.0.1:${redisPort}`
} else redisUrl = redis.url
const owned = {
  ...local,
  ...supabase,
  NODE_ENV: 'test',
  TEST_ENV: 'local',
  DATABASE_URL: databaseUrl.toString(),
  LOCAL_DATABASE_URL: databaseUrl.toString(),
  REDIS_URL: redisUrl,
  PORT: '4088',
  API_BASE_URL: 'http://127.0.0.1:4088',
  API_LISTEN_HOST: '127.0.0.1',
  PUBLIC_API_URL: 'http://127.0.0.1:4088',
  WEB_E2E_BASE_URL: 'http://127.0.0.1:3088',
  HTTP_CORS_ORIGIN: 'http://127.0.0.1:3088',
  E2E_WEATHER_DOUBLE_PORT: '4086',
  WEATHER_PROVIDER_TEST_DOUBLE_PORT: '4086',
  COMMUNITY_FLAG_FIXTURE_MODE: 'true',
  COMMUNITY_SCREENING_EVIDENCE_MODE: 'fixture',
  COMMUNITY_NSFW_SCREENER: 'fixture',
  GARMENT_TAGGING_ENGINE: 'fixture',
  PLAYWRIGHT_SKIP_DB_RESET: 'true',
  POSTHOG_API_KEY: '',
  OPENWEATHER_API_ORIGIN: 'http://127.0.0.1:4086',
  WEATHERAPI_API_ORIGIN: 'http://127.0.0.1:4086',
  OPENWEATHER_API_KEY: 'cc68-weather-double-key',
  WEATHERAPI_API_KEY: 'cc68-weather-double-key',
}
owned.E2E_CALLER_OWNED_ENV_KEYS = Object.keys(owned).sort().join(',')
privateJson('owned-env.json', owned)
privateJson('public-build-env.json', story68PublicBuildEnv(supabase.SUPABASE_ANON_KEY))
function run(label, cmd, args) {
  const output = fs.openSync(path.join(directory, `${label}.log`), 'w', 0o600)
  const child = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...owned },
    stdio: ['ignore', output, output],
  })
  fs.closeSync(output)
  if (child.status !== 0)
    throw new Error(`${label} failed; inspect its private runtime log.`)
}
run('migrate', path.join(root, 'node_modules/.bin/prisma'), [
  'migrate',
  'deploy',
  '--schema',
  'packages/db/prisma/schema.prisma',
])
run('seed', path.join(root, 'node_modules/.bin/tsx'), [
  'packages/db/prisma/seeds/index.ts',
])
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } })
// The seeded forecast ramps with the start time and decides the Home outfit; see the module.
await pinNativeJourneyWeather(prisma)
const authAdmin = createClient(supabaseUrl, supabase.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const identities = []
for (const label of ['primary', 'secondary']) {
  const email = `story65-real-${randomUUID()}@example.test`
  const appUserId = `cc68-native-${randomUUID()}`
  await prisma.user.create({
    data: {
      id: appUserId,
      email,
      profile: {
        create: {
          birthdate: new Date('1990-06-15'),
          preferences: {
            locale: 'en-US',
            role: 'guardian',
            compliance: { accountStatus: 'active' },
          },
        },
      },
    },
  })
  const pending = {
    email,
    appUserId,
    label: `cc68-${label}`,
    issueMode: 'generated',
    pending: true,
  }
  identities.push(pending)
  privateJson('created-identities.json', identities)
  const created = await authAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { app_user_id: appUserId, app_role: 'guardian' },
  })
  if (created.error || !created.data.user)
    throw new Error('Owned synthetic Auth account creation failed.')
  Object.assign(pending, { authUserId: created.data.user.id, pending: false })
  resources.createdIdentities.push({ authUserId: created.data.user.id, email, appUserId })
  privateJson('created-identities.json', identities)
  privateJson('resources.json', resources)
  await prisma.savedLocation.create({
    data: {
      user_id: appUserId,
      label: 'San Francisco',
      location_key: 'san-francisco-ca',
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: 'America/Los_Angeles',
      city: 'San Francisco',
      region: 'CA',
      country: 'US',
      is_primary: true,
    },
  })
  await prisma.comfortPreferences.create({ data: { user_id: appUserId } })
}
const primary = identities[0]
const postId = `cc68-native-${randomUUID()}`
const objectPath = `community/${postId}/${randomUUID()}.png`
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#E9E2D0"/><rect x="80" y="60" width="640" height="880" rx="40" fill="#F8F5EE"/><path d="M280 160 L340 120 L460 120 L520 160 L590 310 L520 350 L485 280 L485 470 L315 470 L315 280 L280 350 L210 310 Z" fill="#7A1F2D"/><path d="M320 485 H480 L520 810 H440 L400 610 L360 810 H280 Z" fill="#292724"/><path d="M280 830 H360 V875 H250 Q230 860 250 845 Z M440 830 H520 L550 845 Q570 860 550 875 H440 Z" fill="#B28D46"/></svg>'
const photo = await sharp(Buffer.from(svg)).png().toBuffer()
resources.storageObjects.push({ bucket: 'community-images', objectPath })
privateJson('resources.json', resources)
const uploaded = await authAdmin.storage
  .from('community-images')
  .upload(objectPath, photo, { contentType: 'image/png', upsert: false })
if (uploaded.error) throw new Error('Owned synthetic card-photo upload failed.')
await prisma.lookbookPost.create({
  data: {
    id: postId,
    user_id: primary.appUserId,
    status: 'published',
    caption: 'A synthetic CC68 outfit for native export proof.',
    alt_text: 'A burgundy top, charcoal trousers and gold shoes.',
    alt_text_confirmed_at: new Date(),
    submitted_at: new Date(),
    published_at: new Date(),
    image_object_path: objectPath,
    image_content_type: 'image/png',
    image_checksum: createHash('sha256').update(photo).digest('hex'),
    image_byte_size: photo.length,
    climate_band: 'temperate_dry',
    locale: 'en-US',
  },
})
const outfits = []
for (const scenario of ['morning', 'midday', 'evening']) {
  const row = await prisma.outfitRecommendation.create({
    data: {
      user_id: primary.appUserId,
      scenario,
      garment_ids: ['default-top', 'default-bottom', 'default-shoes'],
      reasoning_badges: [],
    },
  })
  outfits.push({ id: row.id, scenario })
}
privateJson('fixtures.json', {
  identities,
  postId,
  objectPath,
  photoSha256: createHash('sha256').update(photo).digest('hex'),
  outfits,
})
await prisma.$disconnect()
console.log(
  JSON.stringify({
    runtime: directory,
    database: name,
    redisContainer: resources.redisContainer,
    authAccounts: identities.length,
    ownedPost: postId,
    status: 'ready',
    apiPort: 4088,
    metroPort: 8089,
    authProxyPort: 53068,
  })
)
