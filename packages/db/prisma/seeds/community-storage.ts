// Learning path Step 38: Community feed by climate band.
//
// Uploads the placeholder image object that each seeded community post points
// at.
//
// Why this exists: the seed used to write `image_object_path` values and never
// put bytes behind them. `CommunityService.buildFeedItems` drops any post whose
// image cannot be signed, so `GET /feed?mode=all` answered 200 with an empty
// list while the identical Prisma query returned all five rows — a feed that is
// simultaneously populated and empty depending on which layer you ask. That
// defeats the story's own acceptance criterion that seeded data makes both
// positive paths reachable, and it is invisible from the database alone, which
// is exactly why it survived.
//
// A row whose object does not exist is worse than no row, so this module
// uploads FIRST and lets the seed write the row only once the object is there,
// and it throws rather than warning when storage is unreachable.
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

import { applyLocalSupabaseStorageEnv } from '../../../../scripts/local-e2e-database.mjs'

/** Bucket created by the Story 6.1 migration. Private; the API signs every read. */
const BUCKET = 'community-images'

/**
 * Seeded placeholders are 64x64 so the feed renders as recognisable colour
 * tiles rather than a grid of broken-image icons. At this size a solid PNG is
 * about 140 bytes, so nothing large is committed or uploaded.
 */
const PLACEHOLDER_SIZE_PX = 64

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, checksum])
}

/**
 * Encodes a solid-colour RGB PNG by hand.
 *
 * Hand-rolled rather than pulled from a package because the alternative is
 * adding an image dependency to the database workspace to draw a square, and
 * because a committed binary fixture is the thing this is meant to avoid.
 */
function encodeSolidPng(
  size: number,
  [red, green, blue]: [number, number, number]
): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour RGB

  const row = Buffer.concat([
    Buffer.from([0]), // PNG per-row filter: none
    Buffer.concat(Array.from({ length: size }, () => Buffer.from([red, green, blue]))),
  ])
  const raster = Buffer.concat(Array.from({ length: size }, () => row))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raster, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A stable colour per post, derived from its id, so the seeded feed is visually
 * distinguishable and re-seeding produces byte-identical objects. The channel
 * floor keeps every tile light enough to read a caption against.
 */
function placeholderColour(postId: string): [number, number, number] {
  const digest = createHash('sha256').update(`community-placeholder:${postId}`).digest()
  return [
    0x60 + ((digest[0] ?? 0) % 0x90),
    0x60 + ((digest[1] ?? 0) % 0x90),
    0x60 + ((digest[2] ?? 0) % 0x90),
  ]
}

/**
 * The object path for a seeded post: `community/<postId>/<opaque token>.png`.
 *
 * No user id in any segment. The path travels inside every signed URL, so an
 * owner id here deanonymizes the author to whoever the URL reaches, which the
 * story names as a hard boundary. The seed used to write
 * `community/<userId>/lookbook-N.jpg` and was the last place in the repository
 * still doing it after the factory was fixed.
 *
 * The token is a hash of the post id rather than a fresh random value, so
 * re-seeding replaces the same object instead of orphaning the previous one.
 * Lives here rather than inline in rituals.ts so it can be asserted against the
 * shared `COMMUNITY_OBJECT_PATH_PATTERN` without a database.
 */
export function buildSeededCommunityObjectPath(postId: string): string {
  const token = createHash('sha256')
    .update(`community-object:${postId}`)
    .digest('hex')
    .slice(0, 32)

  return `community/${postId}/${token}.png`
}

export interface SeededCommunityObject {
  objectPath: string
  contentType: string
  byteSize: number
}

export interface CommunityStorageCredentials {
  url: string
  serviceRoleKey: string
}

/**
 * Resolves the storage credentials, or explains precisely how to get them.
 *
 * Every environment this seed runs in has a real Supabase behind it: CI's
 * `start-local-supabase` action exports SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY into the job environment before `npm run db:reset`,
 * and locally `applyLocalSupabaseStorageEnv` reads the same values out of the
 * running stack. So a missing value is a setup mistake to surface, never a
 * reason to seed rows without objects.
 */
export function resolveCommunityStorageCredentials(
  env: NodeJS.ProcessEnv = process.env
): CommunityStorageCredentials {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    // Fill them in from the running local stack before giving up. The helper
    // only ever supplies values that are MISSING, and only for a run that has
    // already declared itself local or test, so CI, preview and production keep
    // exactly the credentials they were handed. It deliberately does not read
    // the repo `.env` files: a stale key there is present and wrong, which no
    // resolver can fix and none should hide.
    applyLocalSupabaseStorageEnv(env)
  }

  const url = env.SUPABASE_URL?.trim()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    const missing = [
      url ? null : 'SUPABASE_URL',
      serviceRoleKey ? null : 'SUPABASE_SERVICE_ROLE_KEY',
    ]
      .filter(Boolean)
      .join(', ')

    throw new Error(
      `Community seed cannot reach Supabase Storage: ${missing} is not set. ` +
        'Every seeded community post needs its image object uploaded, because a post ' +
        'whose object is missing is silently dropped from the feed. Export the values ' +
        'from the running stack first:\n' +
        "  export SUPABASE_URL=$(npx supabase status -o json | jq -r '.API_URL')\n" +
        "  export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o json | jq -r '.SERVICE_ROLE_KEY')\n" +
        'Take them from `npx supabase status` rather than from .env.local, which can ' +
        'hold keys the running stack no longer accepts.'
    )
  }

  return { url: url.replace(/\/+$/, ''), serviceRoleKey }
}

/**
 * Uploads one deterministic placeholder object for `postId` at `objectPath`.
 *
 * `x-upsert` makes re-seeding replace the object in place rather than orphan
 * the previous one, matching the path itself, which is derived from the post id
 * rather than randomised for the same reason.
 */
export async function uploadSeededCommunityObject(
  postId: string,
  objectPath: string,
  credentials: CommunityStorageCredentials
): Promise<SeededCommunityObject> {
  const body = encodeSolidPng(PLACEHOLDER_SIZE_PX, placeholderColour(postId))
  const endpoint = `${credentials.url}/storage/v1/object/${BUCKET}/${objectPath}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.serviceRoleKey}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: new Uint8Array(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '<unreadable body>')
    throw new Error(
      `Community seed failed to upload ${objectPath} to the ${BUCKET} bucket ` +
        `(HTTP ${response.status}): ${detail}\n` +
        'A 403 "Invalid Compact JWS" here usually means SUPABASE_SERVICE_ROLE_KEY is ' +
        'stale relative to the running stack; re-read it from `npx supabase status`. ' +
        'The seed fails rather than continuing, because a LookbookPost row pointing at ' +
        'an object that does not exist is dropped from the feed without any error, ' +
        'which is far harder to diagnose than this message.'
    )
  }

  return { objectPath, contentType: 'image/png', byteSize: body.length }
}
