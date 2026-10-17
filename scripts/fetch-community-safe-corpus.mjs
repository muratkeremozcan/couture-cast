/*
 * Assembles the safe-content corpus: real, openly licensed fashion photographs.
 *
 * Story 6.2b, AC 4. The corpus measures how often the screening policy withholds
 * an ordinary fashion photograph, which is the human review load the beta's
 * moderators inherit. It is drawn from Openverse with `license_type=commercial`,
 * because couture-cast sells subscriptions and the licence has to permit that
 * use. Unsplash is excluded: its dataset licence permits machine-learning use for
 * non-commercial purposes only.
 *
 * The image bytes never enter Git. They are written to the corpus store
 * (`COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR/safe-photographs-v1`, defaulting to the
 * gitignored `apps/api/.cache/community-screening-corpus/safe-photographs-v1`),
 * and the repository keeps only the manifest: opaque id, source, creator,
 * licence, URLs and SHA-256 per photograph.
 *
 * The run is resumable and rate-limit aware. Anonymous Openverse access allows 20
 * requests a minute and 200 a day (read from the live `x-ratelimit-*` headers);
 * the script paces itself under the burst limit, stops cleanly when the daily
 * allowance runs out, honours `Retry-After`, checkpoints after every photograph,
 * and can be re-run until the corpus is complete. With OPENVERSE_CLIENT_ID and
 * OPENVERSE_CLIENT_SECRET set it exchanges them for a bearer token first.
 *
 * Usage:
 *   node scripts/fetch-community-safe-corpus.mjs [--target 260] [--verify-only] [--json]
 *
 * `--verify-only` touches no network: it checks the manifest's integrity,
 * licences, duplicate hashes and minimum count, and, when the store is present,
 * the bytes against their hashes. It exits nonzero on any failure.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

export const MANIFEST_PATH = 'apps/api/test/fixtures/community-safe-corpus/manifest.json'
const CORPUS_ID = 'community-safe-photographs-v1'
export const MINIMUM_COUNT = 500
const DEFAULT_TARGET = 640
const API_BASE = 'https://api.openverse.org/v1'
const PAGE_SIZE = 20
/** Three seconds between API calls keeps a run under the 20-a-minute burst limit. */
const API_SPACING_MS = 3_100
const DOWNLOAD_SPACING_MS = 250
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const USER_AGENT =
  'couture-cast-safe-corpus/1.0 (+https://github.com/muratkeremozcan/couture-cast)'

/**
 * Openverse licence codes that permit commercial use. `license_type=commercial`
 * already filters to these; the manifest check repeats the rule so a corpus that
 * somehow carried a non-commercial licence fails rather than being measured.
 */
export const COMMERCIAL_LICENCES = new Set(['by', 'by-sa', 'by-nd', 'cc0', 'pdm'])

/**
 * Several queries, because one query can return fewer than 250 commercial
 * photographs and anonymous access caps every query at 240 results. Each one
 * describes people wearing clothes, which is where a false positive costs a
 * moderator's time.
 */
export const QUERIES = [
  'street style fashion',
  'fashion model outfit',
  'fashion week street style',
  'woman wearing dress',
  'man wearing suit',
  'winter coat fashion',
  'summer dress fashion',
  'runway fashion show',
  'casual outfit jeans',
  'fashion portrait',
  'outfit of the day',
  'street fashion',
  'fashion blogger',
  'vintage dress',
  'leather jacket fashion',
  'denim jacket outfit',
  'knit sweater fashion',
  'wedding dress',
  'fashion photography model',
  'woman wearing coat',
  'man wearing jacket',
  'hat fashion style',
  'menswear style',
  'streetwear',
  'boho style dress',
  'traditional dress',
  'kimono fashion',
  'hijab fashion',
  'winter fashion',
  'raincoat',
  'fashion shoot',
  'people street fashion',
]

/**
 * The calibration and holdout halves. A threshold is chosen on the calibration
 * half only and the release gate is computed on the holdout half only, so the
 * gate never measures a policy on the photographs it was tuned on.
 *
 * The split is by creator, not by photograph: one photographer's shots share
 * subjects, lighting and post-processing, and splitting them across both halves
 * would let the calibration half preview the holdout. The rule is a pure
 * function of the creator key (source plus normalised creator name): the parity
 * of the first hex digit of its SHA-256.
 */
export const SPLIT_RULE =
  'by creator: first hexadecimal digit of the SHA-256 of the creator key (source:creator, lower-cased), even is calibration, odd is holdout'

/** No creator may hold more than this share of the corpus. */
export const CREATOR_CAP_SHARE = 0.05

export function creatorKey(entry) {
  const creator = (entry.creator ?? '').trim().toLowerCase() || 'unknown'
  return `${entry.source ?? 'unknown'}:${creator}`
}

export function splitOf(entry) {
  const digest = crypto.createHash('sha256').update(creatorKey(entry)).digest('hex')
  return Number.parseInt(digest[0], 16) % 2 === 0 ? 'calibration' : 'holdout'
}

/**
 * Drops photographs past each creator's cap, keeping the first by id, and
 * repeats until stable, because dropping shrinks the corpus and with it the cap.
 */
export function enforceCreatorCap(entries) {
  let kept = [...entries].toSorted((a, b) => (a.id < b.id ? -1 : 1))
  for (;;) {
    const cap = Math.max(1, Math.floor(kept.length * CREATOR_CAP_SHARE))
    const counts = new Map()
    const next = kept.filter((entry) => {
      const key = creatorKey(entry)
      const count = counts.get(key) ?? 0
      counts.set(key, count + 1)
      return count < cap
    })
    if (next.length === kept.length) return kept
    kept = next
  }
}

/**
 * A result is kept only when its title or tags name clothing or style. Openverse
 * ranks loosely, and a query for street style also returns abandoned buildings;
 * those are safe but measure nothing about fashion content.
 */
const FASHION_VOCABULARY =
  /\b(fashion|outfit|ootd|style|stylish|dress|gown|skirt|coat|jacket|blazer|suit|trousers|jeans|denim|sweater|knit|shirt|blouse|t-shirt|tee|hoodie|scarf|hat|boots|shoes|sneakers|heels|handbag|bag|runway|catwalk|model|clothing|clothes|wear|wearing|streetstyle|vintage|kimono|sari|uniform|costume|lookbook)\b/i

function storeDirectory() {
  const base = process.env.COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR?.trim()
  return base
    ? path.resolve(base, 'safe-photographs-v1')
    : path.join(
        projectRoot,
        'apps/api/.cache/community-screening-corpus/safe-photographs-v1'
      )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function readManifest() {
  const fullPath = path.join(projectRoot, MANIFEST_PATH)
  if (!fs.existsSync(fullPath)) return null
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
}

function emptyManifest() {
  return {
    corpusId: CORPUS_ID,
    corpusVersion: 'v1',
    safetyClass: 'openly-licensed-safe-photographs',
    source:
      'Openverse (https://openverse.org), license_type=commercial, category=photograph',
    excluded: {
      unsplash:
        'Unsplash dataset licence permits machine-learning use for non-commercial purposes only.',
    },
    minimumCount: MINIMUM_COUNT,
    queries: QUERIES,
    bytesLocation:
      'Outside Git, in COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR/safe-photographs-v1 (default apps/api/.cache/community-screening-corpus/safe-photographs-v1). Re-create it with npm run community:screening:corpus:fetch.',
    entries: [],
  }
}

async function writeManifest(manifest) {
  const fullPath = path.join(projectRoot, MANIFEST_PATH)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(fullPath)) ?? {}
  const entries = enforceCreatorCap(manifest.entries).map((entry) => ({
    ...entry,
    split: splitOf(entry),
  }))
  const sorted = {
    ...manifest,
    queries: QUERIES,
    minimumCount: MINIMUM_COUNT,
    split: {
      rule: SPLIT_RULE,
      creatorCapShare: CREATOR_CAP_SHARE,
      creators: new Set(entries.map(creatorKey)).size,
      calibration: entries.filter((entry) => entry.split === 'calibration').length,
      holdout: entries.filter((entry) => entry.split === 'holdout').length,
    },
    entries,
  }
  fs.writeFileSync(
    fullPath,
    await prettier.format(`${JSON.stringify(sorted, null, 2)}\n`, {
      ...options,
      parser: 'json',
    })
  )
}

function readCheckpoint(store) {
  const file = path.join(store, 'checkpoint.json')
  if (!fs.existsSync(file)) return { pages: {}, rejected: [] }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeCheckpoint(store, checkpoint) {
  fs.writeFileSync(
    path.join(store, 'checkpoint.json'),
    `${JSON.stringify(checkpoint, null, 2)}\n`
  )
}

class DailyAllowanceExhausted extends Error {}

async function bearerToken() {
  const id = process.env.OPENVERSE_CLIENT_ID?.trim()
  const secret = process.env.OPENVERSE_CLIENT_SECRET?.trim()
  if (!id || !secret) return null
  const response = await fetch(`${API_BASE}/auth_tokens/token/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  })
  if (!response.ok)
    throw new Error(`Openverse token exchange failed: HTTP ${response.status}`)
  const body = await response.json()
  return body.access_token
}

let lastApiCall = 0

async function apiGet(url, token) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const wait = lastApiCall + API_SPACING_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastApiCall = Date.now()
    const response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })
    const sustained = response.headers.get('x-ratelimit-available-anon_sustained')
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '60')
      if (sustained !== null && Number(sustained) <= 0) {
        throw new DailyAllowanceExhausted('The anonymous daily allowance is spent.')
      }
      console.warn(`[corpus] rate limited; waiting ${retryAfter}s as Retry-After asks`)
      await sleep(retryAfter * 1000)
      continue
    }
    if (response.status >= 500) {
      // Openverse returns transient 5xx under load; back off and retry.
      await sleep(attempt * 5_000)
      continue
    }
    if (!response.ok)
      throw new Error(`Openverse request failed: HTTP ${response.status} ${url}`)
    const burst = response.headers.get('x-ratelimit-available-anon_burst')
    if (burst !== null && Number(burst) <= 1) await sleep(60_000)
    if (sustained !== null && Number(sustained) <= 1) {
      throw new DailyAllowanceExhausted(
        'The anonymous daily allowance is about to run out.'
      )
    }
    return response.json()
  }
  throw new Error(`Openverse kept rate limiting ${url}`)
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function download(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
  })
  if (!response.ok) return { rejected: `HTTP ${response.status}` }
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!EXTENSIONS[contentType])
    return { rejected: `unsupported content type ${contentType}` }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { rejected: `unusable size ${bytes.length}` }
  }
  return { bytes, contentType }
}

function isFashionResult(result) {
  const haystack = [
    result.title ?? '',
    ...(result.tags ?? []).map((tag) => tag.name ?? ''),
  ]
  return haystack.some((value) => FASHION_VOCABULARY.test(value))
}

function rejectReason(result, known, creatorCounts, creatorCap) {
  if (known.has(result.id)) return 'already in the manifest'
  if ((creatorCounts.get(creatorKey(result)) ?? 0) >= creatorCap)
    return 'creator at its cap'
  if (!COMMERCIAL_LICENCES.has(result.license)) return `licence ${result.license}`
  if (result.mature) return 'marked mature'
  if ((result.unstable__sensitivity ?? []).length > 0) return 'flagged sensitive'
  if (result.category && result.category !== 'photograph')
    return `category ${result.category}`
  if (!isFashionResult(result)) return 'title and tags name no clothing or style'
  return null
}

function toEntry(result, query, bytes, contentType) {
  return {
    id: result.id,
    source: result.source ?? result.provider ?? null,
    creator: result.creator ?? null,
    license: result.license,
    licenseVersion: result.license_version ?? null,
    licenseUrl: result.license_url ?? null,
    url: result.url,
    landingUrl: result.foreign_landing_url ?? null,
    query,
    sha256: sha256(bytes),
    byteSize: bytes.length,
    contentType,
    file: `${result.id}.${EXTENSIONS[contentType]}`,
  }
}

function searchUrl(query, page) {
  return `${API_BASE}/images/?${new URLSearchParams({
    q: query,
    license_type: 'commercial',
    category: 'photograph',
    page_size: String(PAGE_SIZE),
    page: String(page),
  })}`
}

/** Downloads and records one search result, or notes why it was rejected. */
async function admitResult(result, query, state) {
  if (rejectReason(result, state.known, state.creatorCounts, state.creatorCap)) return
  await sleep(DOWNLOAD_SPACING_MS)
  const fetched = await download(result.url).catch((error) => ({
    rejected: error instanceof Error ? error.message : String(error),
  }))
  state.known.add(result.id)
  if (fetched.rejected) {
    state.checkpoint.rejected.push({ id: result.id, reason: fetched.rejected })
    return
  }
  const entry = toEntry(result, query, fetched.bytes, fetched.contentType)
  if (state.hashes.has(entry.sha256)) return
  fs.writeFileSync(path.join(state.store, entry.file), fetched.bytes)
  state.manifest.entries.push(entry)
  state.hashes.add(entry.sha256)
  state.creatorCounts.set(
    creatorKey(entry),
    (state.creatorCounts.get(creatorKey(entry)) ?? 0) + 1
  )
  await writeManifest(state.manifest)
}

async function fetchQuery(query, state, target, token) {
  // A null checkpoint means the query is exhausted. `?? 1` would restart it.
  if (state.checkpoint.pages[query] === null) return
  let page = state.checkpoint.pages[query] ?? 1
  while (state.manifest.entries.length < target && page !== null) {
    const body = await apiGet(searchUrl(query, page), token)
    for (const result of body.results ?? []) {
      if (state.manifest.entries.length >= target) break
      await admitResult(result, query, state)
    }
    page = page < (body.page_count ?? 0) ? page + 1 : null
    state.checkpoint.pages[query] = page
    writeCheckpoint(state.store, state.checkpoint)
  }
}

async function fetchCorpus(target) {
  const store = storeDirectory()
  fs.mkdirSync(store, { recursive: true })
  const manifest = readManifest() ?? emptyManifest()
  manifest.entries = enforceCreatorCap(manifest.entries)
  const state = {
    store,
    manifest,
    checkpoint: readCheckpoint(store),
    known: new Set(manifest.entries.map((entry) => entry.id)),
    hashes: new Set(manifest.entries.map((entry) => entry.sha256)),
    creatorCounts: manifest.entries.reduce(
      (counts, entry) =>
        counts.set(creatorKey(entry), (counts.get(creatorKey(entry)) ?? 0) + 1),
      new Map()
    ),
    // Against the target size, so the corpus grows across creators rather than
    // filling up from the most prolific one and being trimmed afterwards.
    creatorCap: Math.max(1, Math.floor(target * CREATOR_CAP_SHARE)),
  }
  const token = await bearerToken()

  try {
    for (const query of QUERIES) {
      if (manifest.entries.length >= target) break
      await fetchQuery(query, state, target, token)
    }
  } catch (error) {
    if (!(error instanceof DailyAllowanceExhausted)) throw error
    console.warn(`[corpus] ${error.message} Re-run tomorrow; progress is checkpointed.`)
  }
  await writeManifest(manifest)
  return manifest
}

const REQUIRED_FIELDS = ['id', 'source', 'license', 'url', 'sha256', 'file']

/** Problems with one manifest entry on its own, before any cross-entry check. */
function entryProblems(entry) {
  const problems = REQUIRED_FIELDS.filter((field) => !entry[field]).map(
    (field) => `${entry.id ?? '(no id)'} has no ${field}`
  )
  if (!COMMERCIAL_LICENCES.has(entry.license)) {
    problems.push(
      `${entry.id} carries licence ${entry.license}, which does not permit commercial use`
    )
  }
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
    problems.push(`${entry.id} has a malformed sha256`)
  } else if (entry.split !== splitOf(entry)) {
    problems.push(
      `${entry.id} is recorded in the ${entry.split} half, but its creator key puts it in the other`
    )
  }
  return problems
}

/** Whether the stored bytes are present and still hash to the manifest value. */
function storeProblem(entry, store) {
  const file = path.join(store, entry.file ?? '')
  if (!fs.existsSync(file)) return `${entry.id} is missing from the corpus store`
  return sha256(fs.readFileSync(file)) === entry.sha256
    ? null
    : `${entry.id} bytes no longer match the manifest hash`
}

/** Every check the release run relies on, so an empty or tampered corpus cannot pass. */
export function verifyManifest(manifest, store = storeDirectory()) {
  if (!manifest) return { problems: [`${MANIFEST_PATH} is missing`], bytesChecked: 0 }
  const entries = manifest.entries ?? []
  const problems = []
  if (manifest.corpusId !== CORPUS_ID)
    problems.push(`unexpected corpusId ${manifest.corpusId}`)
  if (entries.length < MINIMUM_COUNT) {
    problems.push(
      `the corpus holds ${entries.length} photographs, below the minimum of ${MINIMUM_COUNT}`
    )
  }
  const cap = Math.max(1, Math.floor(entries.length * CREATOR_CAP_SHARE))
  const perCreator = new Map()
  for (const entry of entries) {
    perCreator.set(creatorKey(entry), (perCreator.get(creatorKey(entry)) ?? 0) + 1)
  }
  for (const [key, count] of perCreator) {
    if (count > cap)
      problems.push(`creator ${key} holds ${count} photographs, above the ${cap} cap`)
  }
  const ids = new Set()
  const hashes = new Set()
  const storePresent = fs.existsSync(store)
  let bytesChecked = 0
  for (const entry of entries) {
    problems.push(...entryProblems(entry))
    if (ids.has(entry.id)) problems.push(`${entry.id} is listed twice`)
    if (hashes.has(entry.sha256))
      problems.push(`${entry.id} duplicates the bytes of another entry`)
    ids.add(entry.id)
    hashes.add(entry.sha256)
    if (!storePresent) continue
    const problem = storeProblem(entry, store)
    if (problem) problems.push(problem)
    else bytesChecked += 1
  }
  return { problems, bytesChecked, storePresent }
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const targetIndex = args.indexOf('--target')
  const target = targetIndex >= 0 ? Number(args[targetIndex + 1]) : DEFAULT_TARGET
  if (!Number.isInteger(target) || target < MINIMUM_COUNT) {
    throw new Error(`--target must be an integer of at least ${MINIMUM_COUNT}`)
  }

  // Verification reads what was written, which carries the split each entry
  // was assigned on write, never the in-memory working copy.
  if (!args.includes('--verify-only')) await fetchCorpus(target)
  const manifest = readManifest()
  const result = verifyManifest(manifest)
  const report = {
    status: result.problems.length === 0 ? 'verified' : 'failed',
    // Without the store only the manifest can be checked; the bytes cannot.
    mode: result.storePresent ? 'manifest-and-bytes' : 'manifest-only',
    entries: manifest?.entries.length ?? 0,
    minimumCount: MINIMUM_COUNT,
    storePresent: result.storePresent,
    bytesChecked: result.bytesChecked,
    licences: Object.fromEntries(
      [...new Set((manifest?.entries ?? []).map((entry) => entry.license))].map(
        (licence) => [
          licence,
          manifest.entries.filter((entry) => entry.license === licence).length,
        ]
      )
    ),
    problems: result.problems,
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(
      `[corpus] ${report.entries} photographs (minimum ${MINIMUM_COUNT}); bytes checked ${report.bytesChecked}; licences ${JSON.stringify(report.licences)}`
    )
    for (const problem of report.problems) console.error(`[corpus] ${problem}`)
  }
  process.exit(report.problems.length === 0 ? 0 : 1)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[corpus] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
