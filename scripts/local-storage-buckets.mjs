#!/usr/bin/env node
/**
 * The Storage buckets a local Supabase needs, provisioned or checked through its
 * Storage API.
 *
 *   node scripts/local-storage-buckets.mjs provision   # create or update every bucket
 *   node scripts/local-storage-buckets.mjs check       # fail naming each missing one
 *
 * The buckets come from the Prisma migrations, which stay their only definition:
 * each `INSERT INTO storage.buckets` there (id, public flag, size limit, MIME types)
 * is read back here and applied the way PostgreSQL applies it. Exactly one
 * statement form is supported, the full-assignment upsert both bucket migrations
 * use: all five columns inserted, then `ON CONFLICT (id) DO UPDATE SET` assigning
 * `public`, `file_size_limit` and `allowed_mime_types` (and optionally `name`) each
 * from its own `EXCLUDED` column, with no `WHERE`. On a conflict the assigned
 * columns replace the earlier definition and an unassigned `name` keeps its earlier
 * value, as in PostgreSQL. Any other form (a plain insert, `DO NOTHING`, a partial
 * or computed `SET`, a `WHERE` condition, other columns) and any other statement
 * touching `storage.buckets` fails the read with the migration named, so a
 * definition this file would apply differently from PostgreSQL never passes.
 *
 * Why the migrations are not enough on their own: they insert only when the
 * database they run against has the Storage schema, and Supabase Storage keeps its
 * buckets in the `postgres` database. A lane that migrates `postgres` (the local
 * Playwright lane) gets them as a side effect; the real-session lane migrates an
 * isolated `tea_community_<32 hex>` database, which has no Storage schema, so its
 * seed found no bucket (CI job 120838157225). `.github/actions/start-local-supabase`
 * therefore runs `provision` right after every local Supabase start, for every job
 * that starts one, and `scripts/e2e-real-session/run.mjs` runs the `check` logic as
 * a preflight.
 *
 * The URL must be loopback, and the service-role key never leaves the request
 * headers: nothing here prints it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONS_DIR = path.join(repoRoot, 'packages/db/prisma/migrations')

/**
 * @typedef {{
 *   id: string
 *   name: string
 *   public: boolean
 *   file_size_limit: number | null
 *   allowed_mime_types: string[] | null
 * }} BucketDefinition
 */

// The whole statement up to its `;`: columns, VALUES tuple, then whatever follows.
const INSERT =
  /INSERT\s+INTO\s+storage\.buckets\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*((?:ON\s+CONFLICT\b[^;]*)?);/gi
const ANY_MENTION = /storage\.buckets/gi
const REGCLASS_PROBE = /to_regclass\(\s*'storage\.buckets'\s*\)/gi

const INSERTED_COLUMNS = ['id', 'name', 'public', 'file_size_limit', 'allowed_mime_types']
/** The columns the supported upsert must assign on a conflict. */
const REQUIRED_ASSIGNMENTS = ['public', 'file_size_limit', 'allowed_mime_types']
const UPSERT = /^ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+)$/i
const ASSIGNMENT = /^(\w+)\s*=\s*EXCLUDED\.(\w+)$/i

/**
 * The columns the conflict action assigns, or a thrown error naming `source` when
 * it is anything but the supported full-assignment upsert.
 *
 * @param {string} clause the statement text after its VALUES tuple
 * @param {string} source
 * @returns {string[]}
 */
function supportedAssignments(clause, source) {
  const reject = (why) => {
    throw new Error(
      `${source}: a storage.buckets insert ${why}; only ON CONFLICT (id) DO UPDATE SET ${REQUIRED_ASSIGNMENTS.map((column) => `${column} = EXCLUDED.${column}`).join(', ')} (name optional, no WHERE) is supported.`
    )
  }
  const text = clause.trim()
  if (text === '') reject('has no ON CONFLICT action')
  if (/\bWHERE\b/i.test(text)) reject('has a WHERE condition on its conflict action')
  const upsert = text.match(UPSERT)
  if (!upsert)
    reject(
      `has an unsupported conflict action (${text.split(/\s+/).slice(0, 6).join(' ')})`
    )
  const assigned = upsert[1].split(',').map((assignment) => {
    const match = assignment.trim().match(ASSIGNMENT)
    if (!match || match[1].toLowerCase() !== match[2].toLowerCase())
      reject(`assigns ${assignment.trim()} on conflict`)
    return match[1].toLowerCase()
  })
  if (new Set(assigned).size !== assigned.length)
    reject('assigns a column twice on conflict')
  for (const column of assigned)
    if (!['name', ...REQUIRED_ASSIGNMENTS].includes(column))
      reject(`assigns ${column} on conflict`)
  for (const column of REQUIRED_ASSIGNMENTS)
    if (!assigned.includes(column)) reject(`leaves ${column} unassigned on conflict`)
  return assigned
}

/** Splits a VALUES list at its top-level commas: none inside quotes or brackets. */
function splitValues(list) {
  const values = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const character of list) {
    if (character === "'") quoted = !quoted
    else if (!quoted && character === '[') depth++
    else if (!quoted && character === ']') depth--
    if (!quoted && depth === 0 && character === ',') {
      values.push(current.trim())
      current = ''
    } else current += character
  }
  values.push(current.trim())
  return values
}

/** One SQL literal of the shapes the bucket inserts use. */
function parseLiteral(token) {
  if (/^'[^']*'$/.test(token)) return token.slice(1, -1)
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true'
  if (/^null$/i.test(token)) return null
  if (/^\d+$/.test(token)) return Number(token)
  const array = token.match(/^ARRAY\s*\[([\s\S]*)\]$/i)
  if (array) return splitValues(array[1]).map((item) => parseLiteral(item))
  throw new Error(`unsupported SQL literal ${token}`)
}

/**
 * The definition one insert's VALUES tuple holds, with every column of its type.
 *
 * @param {readonly string[]} columns
 * @param {string} tuple
 * @param {string} source
 * @returns {BucketDefinition}
 */
function bucketDefinitionFromValues(columns, tuple, source) {
  const values = splitValues(tuple).map((token) => parseLiteral(token))
  if (columns.length !== values.length)
    throw new Error(
      `${source}: a storage.buckets insert has ${columns.length} columns and ${values.length} values.`
    )
  const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
  if (typeof row.id !== 'string' || row.id === '')
    throw new Error(`${source}: a storage.buckets insert has no id.`)
  const mimeTypes = row.allowed_mime_types
  if (
    typeof row.name !== 'string' ||
    typeof row.public !== 'boolean' ||
    (row.file_size_limit !== null && typeof row.file_size_limit !== 'number') ||
    (mimeTypes !== null &&
      !(Array.isArray(mimeTypes) && mimeTypes.every((type) => typeof type === 'string')))
  )
    throw new Error(`${source}: a storage.buckets insert has a value of the wrong type.`)
  return {
    id: row.id,
    name: row.name,
    public: row.public,
    file_size_limit: row.file_size_limit,
    allowed_mime_types: mimeTypes,
  }
}

/**
 * The bucket upserts in one migration's SQL, in statement order: each definition
 * with the columns its conflict action assigns.
 *
 * @param {string} sql
 * @param {string} [source] named in errors
 * @returns {{ definition: BucketDefinition; assigned: string[] }[]}
 */
export function bucketUpsertsFromSql(sql, source = 'migration') {
  const upserts = []
  for (const match of sql.matchAll(INSERT)) {
    const columns = match[1].split(',').map((column) => column.trim().toLowerCase())
    if (
      columns.length !== INSERTED_COLUMNS.length ||
      !INSERTED_COLUMNS.every((column) => columns.includes(column))
    )
      throw new Error(
        `${source}: a storage.buckets insert must list exactly ${INSERTED_COLUMNS.join(', ')}.`
      )
    const assigned = supportedAssignments(match[3], source)
    upserts.push({
      definition: bucketDefinitionFromValues(columns, match[2], source),
      assigned,
    })
  }
  const mentions = (sql.match(ANY_MENTION) ?? []).length
  const probes = (sql.match(REGCLASS_PROBE) ?? []).length
  if (mentions !== probes + upserts.length)
    throw new Error(
      `${source} touches storage.buckets in a way scripts/local-storage-buckets.mjs cannot read; extend it before relying on that migration.`
    )
  return upserts
}

/**
 * Applies upserts to `buckets` as PostgreSQL would: a new id is inserted whole; an
 * existing one takes only the columns its conflict action assigns.
 *
 * @param {Map<string, BucketDefinition>} buckets
 * @param {readonly { definition: BucketDefinition; assigned: readonly string[] }[]} upserts
 */
function applyUpserts(buckets, upserts) {
  for (const { definition, assigned } of upserts) {
    const prior = buckets.get(definition.id)
    if (!prior) {
      buckets.set(definition.id, definition)
      continue
    }
    const next = { ...prior }
    for (const column of assigned) next[column] = definition[column]
    buckets.set(definition.id, next)
  }
  return buckets
}

/**
 * The bucket definitions one migration's SQL leaves, applied in statement order.
 *
 * @param {string} sql
 * @param {string} [source] named in errors
 * @returns {BucketDefinition[]}
 */
export function bucketDefinitionsFromSql(sql, source = 'migration') {
  return [...applyUpserts(new Map(), bucketUpsertsFromSql(sql, source)).values()]
}

/**
 * Every bucket the migrations define, applied in migration order.
 *
 * @param {string} [migrationsDir]
 * @returns {BucketDefinition[]}
 */
export function bucketDefinitionsFromMigrations(migrationsDir = MIGRATIONS_DIR) {
  /** @type {Map<string, BucketDefinition>} */
  const buckets = new Map()
  for (const entry of fs.readdirSync(migrationsDir).sort()) {
    const file = path.join(migrationsDir, entry, 'migration.sql')
    if (!fs.existsSync(file)) continue
    applyUpserts(buckets, bucketUpsertsFromSql(fs.readFileSync(file, 'utf8'), entry))
  }
  return [...buckets.values()]
}

/** @param {string[] | null | undefined} value */
function mimeKey(value) {
  return value ? [...value].sort().join(',') : ''
}

/**
 * What provisioning has to do: create the absent buckets, update the ones whose
 * settings differ, leave the rest.
 *
 * @param {readonly BucketDefinition[]} required
 * @param {readonly Partial<BucketDefinition>[]} existing what the Storage API lists
 */
export function planBuckets(required, existing) {
  const listed = new Map(existing.map((bucket) => [bucket.id, bucket]))
  /** @type {BucketDefinition[]} */
  const create = []
  /** @type {BucketDefinition[]} */
  const update = []
  /** @type {string[]} */
  const unchanged = []
  for (const bucket of required) {
    const current = listed.get(bucket.id)
    if (!current) create.push(bucket)
    else if (
      current.public !== bucket.public ||
      (current.file_size_limit ?? null) !== bucket.file_size_limit ||
      mimeKey(current.allowed_mime_types) !== mimeKey(bucket.allowed_mime_types)
    )
      update.push(bucket)
    else unchanged.push(bucket.id)
  }
  return { create, update, unchanged }
}

/**
 * The required bucket ids the Storage API does not list.
 *
 * @param {readonly { id: string }[]} required
 * @param {readonly { id?: string }[]} existing
 */
export function missingBuckets(required, existing) {
  const listed = new Set(existing.map((bucket) => bucket.id))
  return required.map((bucket) => bucket.id).filter((id) => !listed.has(id))
}

/**
 * Throws, naming each one, when a required bucket is missing. The preflight
 * `run.mjs` and `check` share.
 *
 * @param {readonly { id: string }[]} required
 * @param {readonly { id?: string }[]} existing
 */
export function assertBucketsPresent(required, existing) {
  const missing = missingBuckets(required, existing)
  if (missing.length > 0)
    throw new Error(
      `The local Supabase Storage lacks ${missing.length === 1 ? 'the bucket' : 'the buckets'} the seed needs: ${missing.join(', ')}. Provision them with node scripts/local-storage-buckets.mjs provision.`
    )
}

/**
 * The Storage API of a local Supabase, authenticated with its service-role key.
 *
 * @param {{ supabaseUrl: string; serviceRoleKey: string; fetch?: typeof fetch }} options
 */
export function localStorageApi({ supabaseUrl, serviceRoleKey, fetch: send = fetch }) {
  const origin = new URL(supabaseUrl)
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(origin.hostname))
    throw new Error('Storage buckets are provisioned on a local Supabase only.')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is unset.')
  const base = new URL('/storage/v1/bucket', origin).href
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }
  /** @param {string} url @param {RequestInit} [init] */
  const call = async (url, init) => {
    const response = await send(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    // The status only: an error body may echo the request.
    if (!response.ok)
      throw new Error(
        `Storage API answered ${response.status} for ${init?.method ?? 'GET'} ${new URL(url).pathname}`
      )
    return response.json()
  }
  return {
    /** @returns {Promise<Partial<BucketDefinition>[]>} */
    list: () => call(base),
    /** @param {BucketDefinition} bucket */
    create: (bucket) => call(base, { method: 'POST', body: JSON.stringify(bucket) }),
    /** @param {BucketDefinition} bucket */
    update: (bucket) =>
      call(`${base}/${encodeURIComponent(bucket.id)}`, {
        method: 'PUT',
        body: JSON.stringify(bucket),
      }),
  }
}

/**
 * Lists the buckets, retrying while Storage is still starting.
 *
 * @param {ReturnType<typeof localStorageApi>} api
 * @param {{ timeoutMs?: number; intervalMs?: number }} [options]
 */
export async function listWhenReady(
  api,
  { timeoutMs = 60_000, intervalMs = 2_000 } = {}
) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await api.list()
    } catch (error) {
      if (Date.now() + intervalMs > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}

async function main(command) {
  const api = localStorageApi({
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  })
  const required = bucketDefinitionsFromMigrations()
  const existing = await listWhenReady(api)
  if (command === 'check') {
    assertBucketsPresent(required, existing)
    console.log(
      `[storage-buckets] Present: ${required.map((bucket) => bucket.id).join(', ')}.`
    )
    return 0
  }
  const plan = planBuckets(required, existing)
  for (const bucket of plan.create) await api.create(bucket)
  for (const bucket of plan.update) await api.update(bucket)
  const ids = (list) => list.map((bucket) => bucket.id).join(', ') || 'none'
  console.log(
    `[storage-buckets] Created: ${ids(plan.create)}. Updated: ${ids(plan.update)}. Unchanged: ${plan.unchanged.join(', ') || 'none'}.`
  )
  return 0
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2] ?? 'provision'
  if (!['provision', 'check'].includes(command)) {
    console.error('Usage: local-storage-buckets.mjs [provision|check]')
    process.exit(2)
  }
  main(command).then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`[storage-buckets] ${error.message}`)
      process.exitCode = 1
    }
  )
}
