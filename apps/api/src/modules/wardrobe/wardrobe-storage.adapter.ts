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

const logger = createBaseLogger().child({ feature: 'wardrobe-storage' })

/**
 * Every storage failure answers the same 503 to callers. What Supabase said is
 * logged first, so "object not found" is not mistaken for a permission fault.
 */
function storageUnavailable(
  operation: string,
  error?: { message?: string; name?: string; statusCode?: string | number } | null
): ServiceUnavailableException {
  logger.warn(
    {
      operation,
      storageError: error
        ? { name: error.name, message: error.message, statusCode: error.statusCode }
        : null,
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
