import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { WARDROBE_STAGING_FOLDER } from '@couture/utils'
import { signedUploadExpiry } from '../../common/signed-upload-expiry'
import { createBaseLogger } from '../../logger/pino.config'

const WARDROBE_BUCKET = 'wardrobe-images'

/**
 * Authority for a client to write one object straight to storage, so image bytes never pass
 * through an API function (a Vercel Function refuses a body over about 4.5 MB). The bucket
 * itself enforces the 10 MiB cap and the jpeg/png/webp types; commit verifies the bytes.
 */
export interface WardrobeUploadSession {
  /** The storage signed upload URL, which the client PUTs to exactly as given. */
  uploadUrl: string
  uploadToken: string
  /** When storage stops honoring the token; read from the token itself. */
  tokenExpiresAt: Date
}

export interface StagedUploadObject {
  objectPath: string
  createdAt: Date
}

/** One page of the staging folder, oldest first; `nextCursor` is null on the last page. */
export interface StagedUploadPage {
  objects: StagedUploadObject[]
  nextCursor: string | null
}

/**
 * A download read through a hard byte ceiling. `too_large` means storage holds more than the
 * ceiling, found from the declared length or by counting the stream, without buffering the rest.
 */
export type BoundedDownload =
  | { status: 'present'; bytes: Buffer }
  | { status: 'missing' }
  | { status: 'too_large' }

/** The cache policy of every object the server publishes: a member's private photo. */
export const WARDROBE_OBJECT_CACHE_CONTROL = 'private, max-age=0'

export interface WardrobeStorage {
  /**
   * Signs a one-write upload URL for a staging key. Throws 409 `UPLOAD_BYTES_PRESENT` when the
   * key already holds bytes: staged objects are immutable, so the key cannot be signed again.
   */
  createUploadSession(objectPath: string): Promise<WardrobeUploadSession>
  download(objectPath: string): Promise<Buffer>
  /** The object's bytes, read with a hard ceiling; see {@link BoundedDownload}. */
  downloadBounded(objectPath: string, maxBytes: number): Promise<BoundedDownload>
  /**
   * Writes verified bytes to a final path with server-owned metadata (content type and the
   * private cache policy), overwriting whatever is there. Final paths are never signed, so only
   * the server writes them, and a retried commit writes the same verified bytes again.
   */
  publish(objectPath: string, bytes: Buffer, contentType: string): Promise<void>
  /**
   * Writes bytes to a key that must never change once written (the `held/` copy of a held
   * garment's source), with the same server-owned metadata as {@link publish} and no upsert:
   * `exists` when the key already holds an object, which is left untouched.
   */
  publishOnce(
    objectPath: string,
    bytes: Buffer,
    contentType: string
  ): Promise<'created' | 'exists'>
  /** A page of the staging folder, oldest first. */
  listStagedUploads(limit: number, cursor?: string | null): Promise<StagedUploadPage>
  remove(objectPaths: string[]): Promise<void>
  signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string>
}

export const wardrobeStorageLogger = createBaseLogger().child({
  feature: 'wardrobe-storage',
})

type StorageError = { message?: string; name?: string; statusCode?: string | number }

/** The largest storage error body this adapter reads; error bodies are a few hundred bytes. */
const MAX_ERROR_BODY_BYTES = 4 * 1024

/**
 * What kind of failure Supabase reported, from a fixed list. The message itself
 * is never logged: it can echo the object key, which carries the owner's id.
 */
function storageFailureReason(error?: StorageError | null): string {
  if (!error) return 'no_client'
  const message = (error.message ?? '').toLowerCase()
  const status = Number(error.statusCode)
  if (message.includes('bucket not found')) return 'bucket_missing'
  if (message.includes('not found') || status === 404) return 'object_missing'
  if (
    status === 401 ||
    status === 403 ||
    /jws|jwt|signature|unauthori[sz]ed/.test(message)
  )
    return 'unauthorized'
  if (message.includes('exceeded') || status === 413) return 'too_large'
  if (status >= 500) return 'server_error'
  return 'other'
}

/**
 * Every storage failure answers the same 503 to callers. The operation, the
 * error's name, its numeric status and an allow-listed reason are logged first,
 * so "object not found" is not mistaken for a permission fault.
 */
function storageUnavailable(
  operation: string,
  error?: StorageError | null,
  code = 'STORAGE_PERMISSION_DENIED'
): ServiceUnavailableException {
  const status = Number(error?.statusCode)
  wardrobeStorageLogger.warn(
    {
      operation,
      reason: storageFailureReason(error),
      errorName: error?.name ?? null,
      statusCode: Number.isFinite(status) ? status : null,
    },
    'wardrobe_storage_failed'
  )
  return new ServiceUnavailableException(code)
}

/**
 * True when storage refused to sign because the key already holds an object: its `Duplicate`
 * answer, which the SDK reports as status code 409 with "The resource already exists".
 */
function isDuplicateObjectError(error: StorageError): boolean {
  return (
    String(error.statusCode) === '409' ||
    /already exists|duplicate/i.test(error.message ?? '')
  )
}

/**
 * The object-not-found answer of storage's object routes: the body's `error` is `not_found` (or
 * its `code` is `NoSuchKey`). A missing bucket also answers 404, with "Bucket not found", and
 * so does a proxy in front of storage; neither means the member's bytes are missing, so only
 * this code does. The body is read through a small ceiling.
 */
async function isMissingObjectResponse(response: Response): Promise<boolean> {
  if (response.status !== 404 && response.status !== 400) return false
  let raw: Buffer | null
  try {
    raw = await readBounded(response, MAX_ERROR_BODY_BYTES)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    const body = JSON.parse(raw.toString('utf8')) as {
      statusCode?: unknown
      error?: unknown
      code?: unknown
      message?: unknown
    }
    if (typeof body.message === 'string' && /bucket not found/i.test(body.message)) {
      return false
    }
    return body.error === 'not_found' || body.code === 'NoSuchKey'
  } catch {
    return false
  }
}

/**
 * Reads a response body into one buffer, stopping (and cancelling the stream) the moment it
 * passes `maxBytes`, so an oversized object never sits in memory whole.
 */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length > maxBytes ? null : bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

@Injectable()
export class SupabaseWardrobeStorageAdapter implements WardrobeStorage {
  private readonly client: SupabaseClient | null
  private readonly url: string | null
  private readonly serviceRoleKey: string | null

  constructor() {
    const url = process.env.SUPABASE_URL?.trim()
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

    if (!url || !serviceRoleKey) {
      this.client = null
      this.url = null
      this.serviceRoleKey = null
      return
    }

    this.url = url.replace(/\/+$/, '')
    this.serviceRoleKey = serviceRoleKey
    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }

  private storage() {
    if (!this.client) {
      throw storageUnavailable('configure')
    }
    return this.client.storage.from(WARDROBE_BUCKET)
  }

  /**
   * One object per URL, signed without upsert: the first write to a staging key wins and every
   * later PUT is refused as a duplicate. A pending garment's staged bytes may come under legal
   * hold, and a held source must never change. Signing a key that already holds bytes is
   * refused too, which a replayed allocation answers as 409 `UPLOAD_BYTES_PRESENT`: the bytes
   * are there to commit.
   */
  async createUploadSession(objectPath: string): Promise<WardrobeUploadSession> {
    const { data, error } = await this.storage().createSignedUploadUrl(objectPath)
    if (error && isDuplicateObjectError(error)) {
      throw new ConflictException('UPLOAD_BYTES_PRESENT')
    }
    if (error || !data?.signedUrl || !data.token) {
      throw storageUnavailable('sign_upload', error)
    }
    const tokenExpiresAt = signedUploadExpiry(data.token)
    if (!tokenExpiresAt) {
      // A token this cannot read, or one signed for longer than storage documents.
      throw storageUnavailable('sign_upload', { name: 'SignedUploadTokenRejected' })
    }
    return { uploadUrl: data.signedUrl, uploadToken: data.token, tokenExpiresAt }
  }

  async download(objectPath: string): Promise<Buffer> {
    const { data, error } = await this.storage().download(objectPath)
    if (error || !data) {
      throw storageUnavailable('download', error)
    }
    return Buffer.from(await data.arrayBuffer())
  }

  /**
   * Streams the object from storage's authenticated object route. The SDK's download buffers
   * the whole body before returning, which would let an oversized object reach memory before
   * the verifier could refuse it.
   */
  async downloadBounded(objectPath: string, maxBytes: number): Promise<BoundedDownload> {
    if (!this.url || !this.serviceRoleKey) {
      throw storageUnavailable('configure')
    }
    let response: Response
    try {
      response = await fetch(
        `${this.url}/storage/v1/object/authenticated/${WARDROBE_BUCKET}/${objectPath}`,
        {
          headers: {
            Authorization: `Bearer ${this.serviceRoleKey}`,
            apikey: this.serviceRoleKey,
          },
        }
      )
    } catch (error) {
      throw storageUnavailable(
        'download',
        { name: error instanceof Error ? error.name : 'FetchError' },
        'STORAGE_UNAVAILABLE'
      )
    }
    if (!response.ok) {
      if (await isMissingObjectResponse(response)) {
        return { status: 'missing' }
      }
      // A storage fault, a missing bucket included: never "missing bytes", which would tell the
      // client to upload again while storage is down.
      throw storageUnavailable(
        'download',
        { name: 'StorageHttpError', statusCode: response.status },
        'STORAGE_UNAVAILABLE'
      )
    }
    let bytes: Buffer | null
    try {
      bytes = await readBounded(response, maxBytes)
    } catch (error) {
      // The body broke off mid-stream: a storage fault, never a verdict on the bytes.
      throw storageUnavailable(
        'download',
        { name: error instanceof Error ? error.name : 'StreamError' },
        'STORAGE_UNAVAILABLE'
      )
    }
    return bytes ? { status: 'present', bytes } : { status: 'too_large' }
  }

  async publish(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.storage().upload(objectPath, bytes, {
      contentType,
      upsert: true,
      // The SDK would send `max-age=<cacheControl>`; the header option sets the whole value.
      headers: { 'cache-control': WARDROBE_OBJECT_CACHE_CONTROL },
    })
    if (error) {
      throw storageUnavailable('publish', error)
    }
  }

  async publishOnce(
    objectPath: string,
    bytes: Buffer,
    contentType: string
  ): Promise<'created' | 'exists'> {
    const { error } = await this.storage().upload(objectPath, bytes, {
      contentType,
      upsert: false,
      headers: { 'cache-control': WARDROBE_OBJECT_CACHE_CONTROL },
    })
    if (error && isDuplicateObjectError(error)) return 'exists'
    if (error) {
      throw storageUnavailable('publish_once', error)
    }
    return 'created'
  }

  async listStagedUploads(
    limit: number,
    cursor: string | null = null
  ): Promise<StagedUploadPage> {
    const { data, error } = await this.storage().listV2({
      prefix: `${WARDROBE_STAGING_FOLDER}/`,
      limit,
      sortBy: { column: 'created_at', order: 'asc' },
      ...(cursor ? { cursor } : {}),
    })
    if (error || !data) {
      throw storageUnavailable('list_staging', error)
    }
    const objects: StagedUploadObject[] = []
    for (const entry of data.objects) {
      // Without a delimiter the listing is flat: `name` is the whole key.
      const objectPath = entry.key ?? entry.name
      const createdAt = entry.created_at ? new Date(entry.created_at) : null
      if (
        !objectPath.startsWith(`${WARDROBE_STAGING_FOLDER}/`) ||
        !createdAt ||
        Number.isNaN(createdAt.getTime())
      ) {
        continue
      }
      objects.push({ objectPath, createdAt })
    }
    return {
      objects,
      nextCursor: data.hasNext && data.nextCursor ? data.nextCursor : null,
    }
  }

  async signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.storage().createSignedUrl(
      objectPath,
      expiresInSeconds
    )
    if (error || !data?.signedUrl) {
      throw storageUnavailable('sign', error)
    }
    return data.signedUrl
  }

  async remove(objectPaths: string[]): Promise<void> {
    if (objectPaths.length === 0) {
      return
    }
    const { error } = await this.storage().remove(objectPaths)
    if (error) {
      throw storageUnavailable('remove', error)
    }
  }
}
