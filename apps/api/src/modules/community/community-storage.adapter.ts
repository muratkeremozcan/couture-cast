import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

export const COMMUNITY_IMAGES_BUCKET = 'community-images'

export interface CommunityUploadSession {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
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
  /** Overwrites an object in place, used by the re-encode step. */
  upload(objectPath: string, bytes: Buffer, mimeType: string): Promise<void>
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
      return
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
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
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    const { data, error } = await this.storage().createSignedUploadUrl(objectPath)

    if (error || !data?.signedUrl) {
      throw storageUnavailable()
    }

    return {
      uploadUrl: data.signedUrl,
      uploadToken: data.token,
      expiresAt,
    }
  }

  async download(objectPath: string): Promise<Buffer> {
    const { data, error } = await this.storage().download(objectPath)

    if (error || !data) {
      throw storageUnavailable()
    }

    return Buffer.from(await data.arrayBuffer())
  }

  async upload(objectPath: string, bytes: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.storage().upload(objectPath, bytes, {
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
