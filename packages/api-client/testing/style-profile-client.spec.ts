// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import { describe, expect, it, vi } from 'vitest'
import { updateStyleProfileInputSchema } from '../src/contracts/http/style-profile'
import { Configuration, DefaultApi } from '../src/generated'
import { requestStyleProfile } from '../src/style-profile-client'

const EMPTY = { mood: null, palette: null, texture: null, fit: null, avoid: [] }

function setup() {
  const fetchApi = vi.fn<typeof fetch>()
  const api = new DefaultApi(
    new Configuration({
      basePath: 'https://api.invalid',
      accessToken: 'member-token',
      fetchApi,
    })
  )
  return { api, fetchApi }
}

describe('CC-7.20 style profile client', () => {
  it('reads, updates supplied fields and clears with the member bearer', async () => {
    const { api, fetchApi } = setup()
    const answers = { ...EMPTY, mood: 'classic', palette: 'neutral' }
    fetchApi
      .mockResolvedValueOnce(Response.json({ data: answers }))
      .mockResolvedValueOnce(Response.json({ data: { ...answers, fit: 'relaxed' } }))
      .mockResolvedValueOnce(Response.json({ data: EMPTY }))

    await expect(requestStyleProfile(api, { method: 'GET' })).resolves.toEqual(answers)
    await expect(
      requestStyleProfile(api, { method: 'PATCH', input: { fit: 'relaxed' } })
    ).resolves.toEqual({ ...answers, fit: 'relaxed' })
    await expect(requestStyleProfile(api, { method: 'DELETE' })).resolves.toEqual(EMPTY)

    expect(fetchApi.mock.calls.map(([, init]) => init?.method)).toEqual([
      'GET',
      'PATCH',
      'DELETE',
    ])
    for (const [url, init] of fetchApi.mock.calls) {
      expect(url).toBe('https://api.invalid/api/v1/personalization/style-profile')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer member-token')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(fetchApi.mock.calls.map(([, init]) => init?.body)).toEqual([
      undefined,
      JSON.stringify({ fit: 'relaxed' }),
      undefined,
    ])
  })

  it('rejects an out-of-vocabulary server answer', async () => {
    const { api, fetchApi } = setup()
    fetchApi.mockResolvedValueOnce(
      Response.json({ data: { ...EMPTY, mood: 'invented' } })
    )
    await expect(requestStyleProfile(api, { method: 'GET' })).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  it('sends avoid selections and an explicit clear as JSON arrays', async () => {
    const { api, fetchApi } = setup()
    fetchApi
      .mockResolvedValueOnce(Response.json({ data: { ...EMPTY, avoid: ['mini-skirt'] } }))
      .mockResolvedValueOnce(Response.json({ data: EMPTY }))

    await expect(
      requestStyleProfile(api, { method: 'PATCH', input: { avoid: ['mini-skirt'] } })
    ).resolves.toEqual({ ...EMPTY, avoid: ['mini-skirt'] })
    await expect(
      requestStyleProfile(api, { method: 'PATCH', input: { avoid: [] } })
    ).resolves.toEqual(EMPTY)
    expect(fetchApi.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ avoid: ['mini-skirt'] }),
      JSON.stringify({ avoid: [] }),
    ])
  })

  it('rejects repeated choices and limits the avoid field to three options', () => {
    expect(
      updateStyleProfileInputSchema.safeParse({ avoid: ['mini-skirt', 'mini-skirt'] })
        .error?.issues
    ).toEqual([expect.objectContaining({ code: 'custom', path: ['avoid'] })])
    expect(
      updateStyleProfileInputSchema.safeParse({
        avoid: ['mini-skirt', 'leggings', 'crop-top', 'mini-skirt'],
      }).error?.issues
    ).toContainEqual(expect.objectContaining({ code: 'too_big', path: ['avoid'] }))
  })
})
