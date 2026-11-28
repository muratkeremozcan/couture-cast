// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lookIdeasInputSchema,
  type LookIdeasInput,
} from '../src/contracts/http/look-ideas'
import { generateHttpOpenApiDocument } from '../src/contracts/http/openapi'
import { Configuration, DefaultApi } from '../src/generated'
import { requestLookIdeas } from '../src/look-ideas-client'

const PATH = '/api/v1/personalization/look-ideas'
const INPUT = { weather: 'mild-dry', profile: null } satisfies LookIdeasInput
const ranking = ['first', 'second', 'third'].map((id) => ({
  lookId: `sample:l:${id}`,
  description: 'A simple mix for a mild day.',
}))

function setup() {
  const fetchApi = vi.fn<typeof fetch>()
  const api = new DefaultApi(
    new Configuration({
      basePath: 'https://api.invalid',
      accessToken: 'fixture-bearer',
      fetchApi,
    })
  )
  return { api, fetchApi }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CC-7.23 look ideas client', () => {
  it('posts only the allowed inputs and parses ranking and fallback responses', async () => {
    const { api, fetchApi } = setup()
    fetchApi
      .mockResolvedValueOnce(Response.json({ data: ranking }))
      .mockResolvedValueOnce(Response.json({ data: null }))
    const signal = new AbortController().signal

    await expect(requestLookIdeas(api, INPUT, signal)).resolves.toEqual(ranking)
    await expect(requestLookIdeas(api, INPUT, signal)).resolves.toBeNull()
    expect(fetchApi).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchApi.mock.calls) {
      expect(url).toBe(`https://api.invalid${PATH}`)
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe(JSON.stringify(INPUT))
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer fixture-bearer'
      )
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('rejects invalid response text before it reaches the UI', async () => {
    const { api, fetchApi } = setup()
    fetchApi.mockResolvedValueOnce(
      Response.json({
        data: [
          { ...ranking[0], description: '<script>synthetic</script>' },
          ...ranking.slice(1),
        ],
      })
    )
    await expect(
      requestLookIdeas(api, INPUT, new AbortController().signal)
    ).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  it.each(['caller abort', 'deadline'] as const)(
    'cancels the transport on %s',
    async (trigger) => {
      vi.useFakeTimers()
      const { api, fetchApi } = setup()
      const caller = new AbortController()
      const aborted = new Error('Synthetic fetch aborted')
      fetchApi.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(aborted), { once: true })
          })
      )
      const pending = requestLookIdeas(api, INPUT, caller.signal)
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'FetchError',
        cause: aborted,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchApi).toHaveBeenCalledTimes(1)
      const signal = fetchApi.mock.calls[0]?.[1]?.signal
      expect(signal?.aborted).toBe(false)
      if (trigger === 'deadline') {
        await vi.advanceTimersByTimeAsync(7_999)
        expect(signal?.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
      } else {
        caller.abort()
      }
      await rejected
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('keeps the request strict and publishes private caching on every HTTP response', () => {
    expect(lookIdeasInputSchema.parse(INPUT)).toEqual(INPUT)
    expect(
      lookIdeasInputSchema.safeParse({ ...INPUT, coordinates: [10, 20] }).success
    ).toBe(false)
    const operation = generateHttpOpenApiDocument().paths?.[PATH]?.post
    expect(operation?.security).toEqual([{ bearerAuth: [] }])
    const responses = operation?.responses ?? {}
    expect(Object.keys(responses)).toEqual(['200', '400', '401', '403', '503'])
    for (const response of Object.values(responses)) {
      expect(response).toMatchObject({
        headers: {
          'Cache-Control': { schema: { type: 'string', enum: ['private, no-store'] } },
        },
      })
    }
  })
})
