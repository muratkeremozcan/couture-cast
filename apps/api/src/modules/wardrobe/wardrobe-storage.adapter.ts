import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { createBaseLogger } from '../../logger/pino.config'
import type { GarmentMimeType } from './wardrobe-image-validation'

const WARDROBE_BUCKET = 'wardrobe-images'

export interface WardrobeStorage {
  download(objectPath: string): Promise<Buffer>
  remove(objectPaths: string[]): Promise<void>
  signReadUrl(objectPath: string, expiresInSeconds: number): Promise<string>
  upload(objectPath: string, bytes: Buffer, mimeType: GarmentMimeType): Promise<void>
}

export const wardrobeStorageLogger = createBaseLogger().child({
  feature: 'wardrobe-storage',
})

type StorageError = { message?: string; name?: string; statusCode?: string | number }

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
  error?: StorageError | null
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
  return new ServiceUnavailableException('STORAGE_PERMISSION_DENIED')
}

@Injectable()
export class SupabaseWardrobeStorageAdapter implements WardrobeStorage {
  private readonly client: SupabaseClient | null

  constructor() {
    const url = process.env.SUPABASE_URL?.trim()
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

    if (!url || !serviceRoleKey) {
      this.client = null
      return
    }

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

  async upload(
    objectPath: string,
    bytes: Buffer,
    mimeType: GarmentMimeType
  ): Promise<void> {
    const { error } = await this.storage().upload(objectPath, bytes, {
      cacheControl: 'private, max-age=0',
      contentType: mimeType,
      upsert: false,
    })
    if (error) {
      throw storageUnavailable('upload', error)
    }
  }

  async download(objectPath: string): Promise<Buffer> {
    const { data, error } = await this.storage().download(objectPath)
    if (error || !data) {
      throw storageUnavailable('download', error)
    }
    return Buffer.from(await data.arrayBuffer())
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
