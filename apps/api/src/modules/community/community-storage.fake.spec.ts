// Learning path Step 38: Community feed by climate band.
import { describe, expect, it } from 'vitest'
import { InMemoryCommunityStorage } from './community-storage.fake'

/**
 * The fake is the seam every community spec screens through, so a defect in it
 * silently weakens all of them: a `download()` that answered for an object
 * nobody uploaded is exactly the fail-open the Supabase adapter was changed to
 * stop doing.
 */
describe('InMemoryCommunityStorage', () => {
  it('signs a read URL that carries the path and the expiry', async () => {
    const storage = new InMemoryCommunityStorage()
    const url = await storage.signReadUrl('community/post-1/session.jpg', 900)

    expect(url).toContain(encodeURIComponent('community/post-1/session.jpg'))
    expect(url).toContain('expires=900')
  })

  it('honours a custom sign prefix', async () => {
    const storage = new InMemoryCommunityStorage({ signPrefix: 'https://cdn.test' })
    await expect(storage.signReadUrl('community/p/s.jpg', 60)).resolves.toContain(
      'https://cdn.test/'
    )
  })

  it('signs a whole page in one call', async () => {
    const storage = new InMemoryCommunityStorage()
    const signed = await storage.signReadUrls(
      ['community/a/1.jpg', 'community/b/2.jpg'],
      900
    )

    expect(signed.size).toBe(2)
    expect(signed.get('community/a/1.jpg')).toContain('community%2Fa%2F1.jpg')
  })

  it('mints an upload session whose expiry is in the future', async () => {
    const storage = new InMemoryCommunityStorage()
    const session = await storage.createUploadSession('community/p/s.jpg', 120)

    expect(session.uploadToken).toContain('community/p/s.jpg')
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses to download an object nobody uploaded', async () => {
    // The whole point: an absent object is an error, never placeholder bytes
    // that would screen clean and publish.
    const storage = new InMemoryCommunityStorage()
    await expect(storage.download('community/missing/s.jpg')).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
  })

  it('round-trips an uploaded object', async () => {
    const storage = new InMemoryCommunityStorage()
    await storage.upload('community/p/s.jpg', Buffer.from('bytes'), 'image/jpeg')

    await expect(storage.download('community/p/s.jpg')).resolves.toEqual(
      Buffer.from('bytes')
    )
  })

  it('records removals and makes the object unreadable afterwards', async () => {
    const storage = new InMemoryCommunityStorage()
    storage.put('community/p/s.jpg', Buffer.from('bytes'))

    await storage.remove(['community/p/s.jpg'])

    expect(storage.removed).toEqual(['community/p/s.jpg'])
    await expect(storage.download('community/p/s.jpg')).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
  })
})
