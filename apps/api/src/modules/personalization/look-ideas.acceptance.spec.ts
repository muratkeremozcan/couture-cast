// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import 'reflect-metadata'
import { SAMPLE_CATALOG } from '@couture/utils'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LookIdeasInput } from '../../contracts/http.js'
import { httpTestUrl, listenHttpApp } from '../../testing/loopback-http-app.js'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { LOOK_IDEA_BUDGET, LOOK_IDEA_DEADLINE_MS } from './look-ideas.budget.js'
import { LookIdeasController } from './look-ideas.controller.js'
import { LOOK_IDEA_PROVIDER, type LookIdeaProvider } from './look-ideas.provider.js'
import { LookIdeasService } from './look-ideas.service.js'

const PATH = '/api/v1/personalization/look-ideas'
const OWNER = 'synthetic-lookbook-member'
const HEADERS = { authorization: 'Bearer fixture-token' }
const PROFILE = {
  mood: 'classic',
  palette: 'neutral',
  texture: 'smooth',
  fit: 'fitted',
  avoid: ['leggings'],
} as const
const INPUT = {
  weather: 'warm-dry',
  profile: { ...PROFILE, avoid: [...PROFILE.avoid] },
} satisfies LookIdeasInput

const logs = vi.hoisted(() => ({
  create: vi.fn<(options?: { includeRequestMetadata?: boolean }) => void>(),
  info: vi.fn<(fields: Record<string, unknown>, event: string) => void>(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../logger/pino.config.js', () => ({
  createBaseLogger: (options?: { includeRequestMetadata?: boolean }) => {
    logs.create(options)
    return { ...logs, child: () => logs }
  },
}))

function ranking(input: Parameters<LookIdeaProvider['generate']>[0]) {
  return [...input.candidates].reverse().map(({ lookId }, index) => ({
    lookId,
    description: [
      'A polished mix for the day.',
      'A simple mix for the day.',
      'A cozy mix for the day.',
    ][index]!,
  }))
}

describe('CC-7.23 look ideas acceptance', () => {
  let app: INestApplication
  let service: LookIdeasService
  const generate = vi.fn<LookIdeaProvider['generate']>()
  const reserve = vi.fn()
  const canTeenAccessActiveSurface = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    generate
      .mockReset()
      .mockImplementation((input) => Promise.resolve({ ideas: ranking(input) }))
    reserve.mockReset().mockResolvedValue('allowed')
    canTeenAccessActiveSurface.mockReset().mockResolvedValue(true)
    const module = await Test.createTestingModule({
      controllers: [LookIdeasController],
      providers: [
        LookIdeasService,
        { provide: LOOK_IDEA_PROVIDER, useValue: { generate } },
        { provide: LOOK_IDEA_BUDGET, useValue: { reserve } },
        {
          provide: AccessTokenIdentityService,
          useValue: {
            resolveIdentity: () => Promise.resolve({ userId: OWNER, role: 'teen' }),
          },
        },
        {
          provide: GuardianConsentStateService,
          useValue: {
            canTeenAccess: () => true,
            canTeenAccessNonUploadSurface: () => true,
            canTeenAccessActiveSurface,
          },
        },
      ],
    }).compile()
    service = module.get(LookIdeasService)
    app = module.createNestApplication()
    await listenHttpApp(app)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app?.close()
  })

  it('returns the provider ranking with private caching and an allowlisted provider input', async () => {
    const response = await request(httpTestUrl(app))
      .post(PATH)
      .set(HEADERS)
      .send(INPUT)
      .expect(200)
      .expect('cache-control', 'private, no-store')

    expect(reserve).toHaveBeenCalledExactlyOnceWith(OWNER)
    expect(generate).toHaveBeenCalledTimes(1)
    const [providerInput, signal] = generate.mock.calls[0]!
    expect(signal.aborted).toBe(false)
    const { candidates, ...preferencesAndWeather } = providerInput
    expect(preferencesAndWeather).toStrictEqual(INPUT)
    expect(candidates).toHaveLength(3)
    for (const { lookId, pieces, ...otherFields } of candidates) {
      expect(otherFields).toStrictEqual({})
      expect(SAMPLE_CATALOG.looks.map(({ id }) => id)).toContain(lookId)
      expect(pieces.shoes).toMatch(/^sample:g:/)
      for (const [category, itemId] of Object.entries(pieces)) {
        expect(SAMPLE_CATALOG.garments.find(({ id }) => id === itemId)?.category).toBe(
          category
        )
      }
    }
    expect(response.body).toEqual({ data: ranking(providerInput) })
    expect(logs.create).toHaveBeenCalledWith({ includeRequestMetadata: false })
    expect(logs.info).toHaveBeenCalledTimes(1)
    const [fields, event] = logs.info.mock.calls[0]!
    expect(event).toBe('look_ideas_generation')
    expect(fields).toStrictEqual({ outcome: 'generated', durationMs: fields.durationMs })
    expect(Number.isFinite(fields.durationMs)).toBe(true)
  })

  it('blocks missing authentication and guardian-pending access before reserving spend', async () => {
    const api = request(httpTestUrl(app))
    await api.post(PATH).send(INPUT).expect(401)
    canTeenAccessActiveSurface.mockResolvedValue(false)
    await api.post(PATH).set(HEADERS).send(INPUT).expect(403)

    expect(canTeenAccessActiveSurface).toHaveBeenCalledExactlyOnceWith(OWNER)
    expect(reserve).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it.each([
    { ...INPUT, latitude: 10, longitude: 20 },
    { ...INPUT, profile: { ...INPUT.profile, note: 'Free text' } },
    { ...INPUT, profile: { ...INPUT.profile, mood: 'favorite' } },
  ])('rejects out-of-contract input before any provider call (%j)', async (body) => {
    await request(httpTestUrl(app)).post(PATH).set(HEADERS).send(body).expect(400)
    expect(reserve).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown look ID', { lookId: 'sample:l:unknown' }],
    ['unbounded text', { description: 'a'.repeat(500) }],
    ['markup', { description: '<b>A simple mix for the day.</b>' }],
    ['body inference', { description: 'A slimming outfit for your body.' }],
    ['age inference', { description: 'A look for a 14-year-old.' }],
    ['identity inference', { description: 'This outfit reveals your identity.' }],
    [
      'attractiveness inference',
      { description: 'This outfit makes you more attractive.' },
    ],
    ['unsafe suggestion', { description: 'Set your clothes on fire.' }],
    ['unknown field', { itemId: 'sample:g:unknown' }],
  ])('keeps the fallback for %s', async (_case, override) => {
    generate.mockImplementationOnce((input) => {
      const [first, ...rest] = ranking(input)
      return Promise.resolve({ ideas: [{ ...first, ...override }, ...rest] })
    })
    await expect(service.generate(OWNER, INPUT)).resolves.toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects incomplete and duplicate rankings', async () => {
    generate
      .mockImplementationOnce((input) =>
        Promise.resolve({ ideas: ranking(input).slice(0, 2) })
      )
      .mockImplementationOnce((input) => {
        const [first, second] = ranking(input)
        return Promise.resolve({ ideas: [first, second, first] })
      })
    await expect(service.generate(OWNER, INPUT)).resolves.toBeNull()
    await expect(service.generate(OWNER, INPUT)).resolves.toBeNull()
  })

  it.each(['account_limit', 'spend_limit', 'unavailable'])(
    'keeps the fallback without generation when the budget reports %s',
    async (outcome) => {
      reserve.mockResolvedValueOnce(outcome)
      await expect(service.generate(OWNER, INPUT)).resolves.toBeNull()
      expect(reserve).toHaveBeenCalledExactlyOnceWith(OWNER)
      expect(generate).not.toHaveBeenCalled()
    }
  )

  it('aborts a hanging provider at the deadline and answers with a fallback', async () => {
    vi.useFakeTimers()
    generate.mockImplementationOnce(() => new Promise(() => undefined))
    const pending = service.generate(OWNER, INPUT)
    await vi.advanceTimersByTimeAsync(0)
    expect(generate).toHaveBeenCalledTimes(1)
    const [, signal] = generate.mock.calls[0]!
    expect(signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(LOOK_IDEA_DEADLINE_MS)

    await expect(pending).resolves.toBeNull()
    expect(signal.aborted).toBe(true)
  })

  it('keeps the fallback when reserving spend consumes the generation deadline', async () => {
    vi.useFakeTimers()
    reserve.mockReturnValueOnce(new Promise(() => undefined))
    const pending = service.generate(OWNER, INPUT)

    await vi.advanceTimersByTimeAsync(LOOK_IDEA_DEADLINE_MS)

    await expect(pending).resolves.toBeNull()
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps provider error content out of outcome telemetry', async () => {
    generate.mockRejectedValueOnce(new Error('fixture detail for privacy assertion'))
    const response = await request(httpTestUrl(app))
      .post(PATH)
      .set(HEADERS)
      .send(INPUT)
      .expect(200)
    expect(response.body).toEqual({ data: null })
    expect(logs.info).toHaveBeenCalledTimes(1)
    const [fields, event] = logs.info.mock.calls[0]!
    expect(event).toBe('look_ideas_generation')
    expect(fields).toStrictEqual({
      outcome: 'provider_error',
      durationMs: fields.durationMs,
    })
    expect(Number.isFinite(fields.durationMs)).toBe(true)
    expect(logs.warn).not.toHaveBeenCalled()
    expect(logs.error).not.toHaveBeenCalled()
  })

  it('delivers 20 valid fixture generations at a p95 of five seconds or less', async () => {
    const durations: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      const result = await service.generate(OWNER, INPUT)
      durations.push(performance.now() - started)
      expect(result).toHaveLength(3)
    }

    expect(generate).toHaveBeenCalledTimes(20)
    const p95 = durations.sort((a, b) => a - b)[Math.ceil(0.95 * durations.length) - 1]!
    expect(p95).toBeLessThanOrEqual(5_000)
  })
})
