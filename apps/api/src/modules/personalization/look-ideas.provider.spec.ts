// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import {
  createMemberLookbook,
  MEMBER_LOOKBOOK_DESCRIPTION_CHOICES,
  memberLookbookRankingCandidates,
} from '@couture/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GatewayLookIdeaProvider,
  type LookIdeaProviderInput,
} from './look-ideas.provider.js'

const input: LookIdeaProviderInput = {
  weather: 'mild-dry',
  profile: null,
  candidates: memberLookbookRankingCandidates(createMemberLookbook('mild-dry')),
}
const fixtureOutput = {
  ideas: input.candidates.map(({ lookId }) => ({
    lookId,
    description: 'A simple mix for a mild day.',
  })),
}
const completion = {
  choices: [
    { finish_reason: 'stop', message: { content: JSON.stringify(fixtureOutput) } },
  ],
}

const fetch = vi.fn<typeof globalThis.fetch>()

beforeEach(() => {
  fetch.mockReset().mockImplementation(() => Promise.resolve(Response.json(completion)))
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CI', undefined)
  vi.stubEnv('TEST_ENV', undefined)
  vi.stubEnv('VERCEL_ENV', undefined)
  vi.stubEnv('LOOK_IDEAS_ENABLED', 'true')
  vi.stubEnv('AI_GATEWAY_API_KEY', 'fixture-key')
  vi.stubEnv('VERCEL_OIDC_TOKEN', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('CC-7.23 Gateway look ideas adapter', () => {
  it('pins the model, applies provider privacy controls, and requests bounded structured output', async () => {
    const signal = new AbortController().signal
    const provider = new GatewayLookIdeaProvider()
    expect(provider.enabled).toBe(true)
    await expect(provider.generate(input, signal)).resolves.toEqual(fixtureOutput)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture-key',
        'content-type': 'application/json',
      },
      redirect: 'error',
      signal,
    })
    expect(typeof init?.body).toBe('string')
    const payload = JSON.parse(init?.body as string) as { messages?: unknown }
    expect(payload).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 400,
      providerOptions: {
        gateway: {
          only: ['anthropic'],
          zeroDataRetention: true,
          disallowPromptTraining: true,
        },
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            additionalProperties: false,
            required: ['ideas'],
            properties: {
              ideas: {
                type: 'array',
                items: {
                  additionalProperties: false,
                  required: ['lookId', 'description'],
                  properties: {
                    lookId: { enum: input.candidates.map(({ lookId }) => lookId) },
                    description: { enum: MEMBER_LOOKBOOK_DESCRIPTION_CHOICES },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(payload.messages).toHaveLength(2)
    const [system, user] = payload.messages as { role: string; content: string }[]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('Describe the clothes and weather.')
    expect(user).toStrictEqual({ role: 'user', content: JSON.stringify(input) })
  })

  it.each([
    ['CI', 'true'],
    ['NODE_ENV', 'test'],
    ['TEST_ENV', 'local'],
    ['TEST_ENV', 'preview'],
    ['VERCEL_ENV', 'preview'],
    ['LOOK_IDEAS_ENABLED', 'false'],
  ] as const)('prevents dispatch with a key when %s=%s', async (key, value) => {
    vi.stubEnv(key, value)
    const provider = new GatewayLookIdeaProvider()

    expect(provider.enabled).toBe(false)
    await expect(
      provider.generate(input, new AbortController().signal)
    ).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails closed when an enabled environment has no key', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', undefined)
    const provider = new GatewayLookIdeaProvider()

    expect(provider.enabled).toBe(false)
    await expect(
      provider.generate(input, new AbortController().signal)
    ).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses and refreshes the OIDC credential on the same provider instance', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', undefined)
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'fixture-oidc-initial')
    const provider = new GatewayLookIdeaProvider()
    const signal = new AbortController().signal

    expect(provider.enabled).toBe(true)
    await expect(provider.generate(input, signal)).resolves.toEqual(fixtureOutput)
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'fixture-oidc-rotated')
    await expect(provider.generate(input, signal)).resolves.toEqual(fixtureOutput)
    expect(
      fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'))
    ).toEqual(['Bearer fixture-oidc-initial', 'Bearer fixture-oidc-rotated'])
  })

  it('cancels an upstream failure body and returns only a fixed diagnostic', async () => {
    const cancelled = vi.fn()
    const failure = new Response(new ReadableStream({ cancel: cancelled }), {
      status: 503,
    })
    fetch.mockResolvedValueOnce(failure)

    await expect(
      new GatewayLookIdeaProvider().generate(input, new AbortController().signal)
    ).rejects.toThrow('Look ideas provider request failed')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it.each(['declared length', 'streamed bytes'] as const)(
    'cancels an oversized response detected by %s before parsing it',
    async (sizeSource) => {
      const cancel = vi.fn()
      const streamed = sizeSource === 'streamed bytes'
      fetch.mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              if (streamed) {
                controller.enqueue(new Uint8Array(16_384))
                controller.enqueue(new Uint8Array(16_385))
              }
            },
            cancel,
          }),
          {
            headers: streamed ? {} : { 'content-length': '32769' },
          }
        )
      )

      await expect(
        new GatewayLookIdeaProvider().generate(input, new AbortController().signal)
      ).rejects.toThrow('Look ideas provider response exceeded the size limit')
      expect(cancel).toHaveBeenCalledOnce()
    }
  )

  it('rejects a truncated completion before parsing it as a ranking', async () => {
    fetch.mockResolvedValueOnce(
      Response.json({
        choices: [{ finish_reason: 'length', message: { content: '{"ideas":' } }],
      })
    )
    const provider = new GatewayLookIdeaProvider()

    await expect(provider.generate(input, new AbortController().signal)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
