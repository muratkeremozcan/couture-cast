import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

export const COMMUNITY_IMAGES_BUCKET = 'community-images'

export interface CommunityUploadSession {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
}

/**
 * How long a signed upload token lets a request start. Storage sets this per deployment and clients
 * cannot shorten it: Supabase documents 2 hours, and the storage server checks the token's expiry
 * when a request starts, before it reads the body.
 */
export const COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS = 2 * 60 * 60 * 1000

/**
 * Storage checks the token once and does not cut a request already running, so this process ends its
 * own. A frozen process cannot run this timer; erasure's delete window does not rely on it.
 */
export const COMMUNITY_SIGNED_UPLOAD_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

/** Allowance for the storage server's clock when reading a token's expiry. */
const TOKEN_CLOCK_SKEW_MS = 60 * 1000

/**
 * The expiry in the token itself. Erasure's delete window is sized for this lifetime, so a deployment
 * that signs longer tokens, or a token this cannot read, fails closed.
 */
function signedUploadExpiry(token: string): Date {
  const payload = token.split('.')[1]
  let exp: unknown
  try {
    exp = (
      JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as { exp?: unknown }
    ).exp
  } catch {
    throw storageUnavailable()
  }
  if (typeof exp !== 'number') throw storageUnavailable()
  const expiresAt = new Date(exp * 1000)
  const latest = Date.now() + COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS + TOKEN_CLOCK_SKEW_MS
  if (expiresAt.getTime() > latest) throw storageUnavailable()
  return expiresAt
}

const fetchWithUploadTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(COMMUNITY_SIGNED_UPLOAD_REQUEST_TIMEOUT_MS),
  })

export interface CommunityOverwriteCapability {
  objectPath: string
  token: string
  expiresAt: Date
}

export interface CommunityStorage {
  signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string>
  /** One round trip for a whole feed page. Resolves to a path -> URL map. */
  signReadUrls(
    objectPaths: string[],
    expiresInSeconds: number
  ): Promise<Map<string, string>>
  createUploadSession(
    objectPath: string,
    expiresInSeconds?: number
  ): Promise<CommunityUploadSession>
  download(objectPath: string): Promise<Buffer>
  /**
   * Authority to overwrite one object, which storage itself stops honoring when it expires. Mint it
   * before the reservation it serves: a pause can follow any check this process makes, so only
   * storage refusing the request bounds when that write can start.
   */
  createOverwriteCapability(objectPath: string): Promise<CommunityOverwriteCapability>
  /** Overwrites an object in place, used by the re-encode step. */
  upload(
    objectPath: string,
    bytes: Buffer,
    mimeType: string,
    capability: CommunityOverwriteCapability
  ): Promise<void>
  remove(objectPaths: string[]): Promise<void>
}

function storageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('STORAGE_PERMISSION_DENIED')
}

/**
 * Fails closed at construction rather than degrading to placeholders.
 *
 * The previous shape kept a `null` client and answered every method with a
 * usable-looking fake: `download()` returned the literal bytes
 * `mock-community-image-bytes`, which the moderation processor screened,
 * passed, and published. A missing environment variable therefore auto-published
 * content that was never screened. `signReadUrl()` handed out an unsigned
 * `https://storage.local/...` URL for the same reason.
 *
 * The project rule is to fail closed when environment or resource identity is
 * ambiguous, so an absent `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` outside
 * the test environment is now a startup error. Specs inject
 * `InMemoryCommunityStorage` explicitly instead of relying on the degraded
 * branch, which is what makes "an image was screened" mean the same thing in a
 * test and in production.
 */
@Injectable()
export class SupabaseCommunityStorageAdapter implements CommunityStorage {
  private readonly client: SupabaseClient | null
  /** Its own client, because storage-js takes no abort signal on a signed upload. */
  private readonly uploadClient: SupabaseClient | null

  constructor() {
    const url = process.env.SUPABASE_URL?.trim()
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

    if (!url || !serviceRoleKey) {
      if (!allowsTestOnlySecrets()) {
        throw new Error(
          'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for community storage'
        )
      }
      this.client = null
      this.uploadClient = null
      return
    }

    const auth = { autoRefreshToken: false, persistSession: false }
    this.client = createClient(url, serviceRoleKey, { auth })
    this.uploadClient = createClient(url, serviceRoleKey, {
      auth,
      global: { fetch: fetchWithUploadTimeout },
    })
  }

  private storage() {
    if (!this.client) {
      throw storageUnavailable()
    }
    return this.client.storage.from(COMMUNITY_IMAGES_BUCKET)
  }

  async signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.storage().createSignedUrl(
      objectPath,
      expiresInSeconds
    )

    if (error || !data?.signedUrl) {
      throw storageUnavailable()
    }

    return data.signedUrl
  }

  /**
   * Signs a whole feed page in one call. The previous shape signed each item
   * individually, which cost up to thirty storage round trips per page.
   *
   * A path that fails to sign is simply absent from the returned map, so the
   * caller renders an explicit unavailable state for that item instead of
   * failing the entire feed for one bad object.
   */
  async signReadUrls(
    objectPaths: string[],
    expiresInSeconds: number
  ): Promise<Map<string, string>> {
    const signed = new Map<string, string>()
    if (objectPaths.length === 0) {
      return signed
    }

    const { data, error } = await this.storage().createSignedUrls(
      objectPaths,
      expiresInSeconds
    )

    if (error || !data) {
      throw storageUnavailable()
    }

    for (const entry of data) {
      if (entry.signedUrl && entry.path) {
        signed.set(entry.path, entry.signedUrl)
      }
    }

    return signed
  }

  async createUploadSession(
    objectPath: string,
    expiresInSeconds = 900
  ): Promise<CommunityUploadSession> {
    const { data, error } = await this.storage().createSignedUploadUrl(objectPath)

    if (error || !data?.signedUrl) {
      throw storageUnavailable()
    }
    // `expiresAt` is the client's upload window and publish enforces it. The token lasts longer.
    signedUploadExpiry(data.token)

    return {
      uploadUrl: data.signedUrl,
      uploadToken: data.token,
      // From after the mint, so a slow mint cannot leave a live token behind an old expiry.
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }
  }

  async download(objectPath: string): Promise<Buffer> {
    const { data, error } = await this.storage().download(objectPath)

    if (error || !data) {
      throw storageUnavailable()
    }

    return Buffer.from(await data.arrayBuffer())
  }

  /** Export-only bounded streaming path. Existing callers keep download(). */
  async downloadBounded(
    objectPath: string,
    maxBytes: number,
    parentSignal: AbortSignal
  ): Promise<Buffer> {
    const base = process.env.SUPABASE_URL?.trim()
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (
      !base ||
      !key ||
      !/^community\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(
        objectPath
      )
    )
      throw storageUnavailable()
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const abort = () => {
      controller.abort()
      void reader?.cancel().catch(() => undefined)
    }
    parentSignal.addEventListener('abort', abort, { once: true })
    if (parentSignal.aborted) controller.abort()
    const timer = setTimeout(abort, 5000)
    try {
      const response = await fetch(
        `${base.replace(/\/+$/, '')}/storage/v1/object/authenticated/${COMMUNITY_IMAGES_BUCKET}/${objectPath}`,
        {
          headers: { Authorization: `Bearer ${key}`, apikey: key },
          signal: controller.signal,
          redirect: 'error',
        }
      )
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length')) > maxBytes
      ) {
        await response.body?.cancel()
        throw storageUnavailable()
      }
      reader = response.body.getReader()
      const parts: Buffer[] = []
      let size = 0
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > maxBytes || controller.signal.aborted) {
          await reader.cancel()
          throw storageUnavailable()
        }
        parts.push(Buffer.from(next.value))
      }
      if (controller.signal.aborted) throw storageUnavailable()
      return Buffer.concat(parts)
    } catch {
      throw storageUnavailable()
    } finally {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', abort)
      await reader?.cancel().catch(() => undefined)
    }
  }

  async createOverwriteCapability(
    objectPath: string
  ): Promise<CommunityOverwriteCapability> {
    const { data, error } = await this.storage().createSignedUploadUrl(objectPath, {
      upsert: true,
    })
    if (error || !data?.token) {
      throw storageUnavailable()
    }
    return { objectPath, token: data.token, expiresAt: signedUploadExpiry(data.token) }
  }

  async upload(
    objectPath: string,
    bytes: Buffer,
    mimeType: string,
    capability: CommunityOverwriteCapability
  ): Promise<void> {
    if (!this.uploadClient) {
      throw storageUnavailable()
    }
    const { error } = await this.uploadClient.storage
      .from(COMMUNITY_IMAGES_BUCKET)
      .uploadToSignedUrl(objectPath, capability.token, bytes, {
        cacheControl: 'private, max-age=0',
        contentType: mimeType,
        upsert: true,
      })
    if (error) {
      throw storageUnavailable()
    }
  }

  /**
   * A failed delete is raised, not ignored. Takedown and erasure both depend on
   * the object actually going away, so a silent failure here is the difference
   * between "content removed" and "content still served from a signed URL".
   */
  async remove(objectPaths: string[]): Promise<void> {
    if (objectPaths.length === 0) {
      return
    }

    const { error } = await this.storage().remove(objectPaths)
    if (error) {
      throw storageUnavailable()
    }
  }
}
