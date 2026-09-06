import { ServiceUnavailableException } from '@nestjs/common'
import type {
  CommunityStorage,
  CommunityUploadSession,
} from './community-storage.adapter.js'

/**
 * The explicit test double that replaced the Supabase adapter's old
 * "no client configured" degraded branch.
 *
 * That branch made an unconfigured environment indistinguishable from a working
 * one: `download()` answered with placeholder bytes that screened clean, so a
 * post could reach `published` without any image ever being examined. Making the
 * fake a separate object means a spec has to opt into it, and production has no
 * path that reaches it at all.
 *
 * Objects are held in memory keyed by path, so a spec can assert what was
 * uploaded, what was signed, and what was removed.
 */
export class InMemoryCommunityStorage implements CommunityStorage {
  readonly objects = new Map<string, Buffer>()
  readonly removed: string[] = []

  constructor(private readonly options: { signPrefix?: string } = {}) {}

  put(objectPath: string, bytes: Buffer): void {
    this.objects.set(objectPath, bytes)
  }

  signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
    const prefix = this.options.signPrefix ?? 'https://storage.test/community'
    return Promise.resolve(
      `${prefix}/${encodeURIComponent(objectPath)}?expires=${expiresInSeconds}`
    )
  }

  async signReadUrls(
    objectPaths: string[],
    expiresInSeconds: number
  ): Promise<Map<string, string>> {
    const signed = new Map<string, string>()
    for (const objectPath of objectPaths) {
      signed.set(objectPath, await this.signReadUrl(objectPath, expiresInSeconds))
    }
    return signed
  }

  createUploadSession(
    objectPath: string,
    expiresInSeconds = 900
  ): Promise<CommunityUploadSession> {
    return Promise.resolve({
      uploadUrl: `https://storage.test/community/upload/${encodeURIComponent(objectPath)}`,
      uploadToken: `test-upload-token-${objectPath}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    })
  }

  download(objectPath: string): Promise<Buffer> {
    const bytes = this.objects.get(objectPath)
    if (!bytes) {
      return Promise.reject(new ServiceUnavailableException('STORAGE_PERMISSION_DENIED'))
    }
    return Promise.resolve(bytes)
  }

  upload(objectPath: string, bytes: Buffer, _mimeType: string): Promise<void> {
    this.objects.set(objectPath, bytes)
    return Promise.resolve()
  }

  remove(objectPaths: string[]): Promise<void> {
    for (const objectPath of objectPaths) {
      this.objects.delete(objectPath)
      this.removed.push(objectPath)
    }
    return Promise.resolve()
  }
}
