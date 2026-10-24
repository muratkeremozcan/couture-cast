import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { seedWardrobeItems } from '../prisma/seeds/wardrobe.js'

/**
 * Every seeded garment is `ready`, and the API signs a ready garment's image on
 * every read, so the seed must put an object behind each row. It used to write
 * the rows alone: `GET /api/v1/wardrobe/garments` for a seeded teen then failed
 * with 503 on every k6 smoke run, because storage cannot sign an object that was
 * never uploaded.
 */
describe('wardrobe seed storage objects', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function recordingPrisma(events: string[]) {
    const model = (name: string) =>
      new Proxy(
        {},
        {
          get: (_, method: string) =>
            vi.fn((args: { where?: { id?: string } }) => {
              if (name === 'garmentItem' && method === 'upsert')
                events.push(`row ${args.where?.id}`)
              return Promise.resolve({})
            }),
        }
      )
    return new Proxy({}, { get: (_, name: string) => model(name) }) as PrismaClient
  }

  it('uploads each garment image to the wardrobe bucket before writing its row', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://storage.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const events: string[] = []
    const fetch = vi.fn((url: string, init: RequestInit) => {
      events.push(`object ${url.replace('http://storage.test/storage/v1/object/', '')}`)
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer service-role-key',
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      })
      return Promise.resolve(new Response(null, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetch)

    const garments = await seedWardrobeItems(recordingPrisma(events), [
      { id: 'teen-1', email: 'teen-1@synthetic.test' },
    ])

    expect(garments).toHaveLength(10)
    for (const garment of garments) {
      const upload = events.findIndex(
        (event) =>
          event.startsWith('object wardrobe-images/') && event.includes(`/${garment.id}`)
      )
      expect(upload, `${garment.id} has an uploaded object`).toBeGreaterThanOrEqual(0)
      expect(upload).toBeLessThan(events.indexOf(`row ${garment.id}`))
    }
    expect(fetch).toHaveBeenCalledTimes(10)
  })

  it('fails the seed when storage refuses an upload', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://storage.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('bucket not found', { status: 404 })))
    )

    await expect(
      seedWardrobeItems(recordingPrisma([]), [
        { id: 'teen-1', email: 'teen-1@synthetic.test' },
      ])
    ).rejects.toThrow(/wardrobe-images bucket \(HTTP 404\)/)
  })
})
