import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'

describe('SupabaseWardrobeStorageAdapter', () => {
  it('throws storageUnavailable when client is null in test mode', async () => {
    const adapter = new SupabaseWardrobeStorageAdapter()

    await expect(
      adapter.upload('path.png', Buffer.from('data'), 'image/png')
    ).rejects.toThrow(ServiceUnavailableException)
    await expect(adapter.download('path.png')).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(adapter.signReadUrl('path.png', 600)).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(adapter.remove(['path.png'])).rejects.toThrow(
      ServiceUnavailableException
    )
  })

  it('no-ops remove when empty array provided', async () => {
    const adapter = new SupabaseWardrobeStorageAdapter()
    await expect(adapter.remove([])).resolves.toBeUndefined()
  })
})
