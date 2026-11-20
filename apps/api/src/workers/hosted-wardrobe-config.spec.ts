// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { describe, expect, it } from 'vitest'
import { allowsTestOnlySecrets } from '../config/runtime-environment'
import { createSilhouetteModerationEngine } from './wardrobe.bootstrap'
import { FixtureSilhouettePhotoModerationEngine } from '../modules/wardrobe/fixture-silhouette-photo-moderation.engine'
import {
  HOSTED_REQUIRED_ENV,
  ISOLATED_DRILL_ENV,
  assertHostedWardrobeConfig,
  hostedWardrobeConfigProblems,
  isIsolatedDrillEnv,
} from './hosted-wardrobe-config'

const hosted: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pw@db.example.com:5432/postgres',
  REDIS_URL: 'rediss://default:pw@redis.example.com:6379',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GARMENT_TAGGING_ENGINE: 'manual',
  WARDROBE_MAINTENANCE_ENABLED: 'true',
}

describe('hostedWardrobeConfigProblems', () => {
  it('accepts the hosted service configuration, with the heuristic selectors set or unset', () => {
    expect(hostedWardrobeConfigProblems(hosted)).toEqual([])
    expect(
      hostedWardrobeConfigProblems({
        ...hosted,
        SILHOUETTE_MODERATION_ENGINE: 'heuristic',
        PALETTE_ANALYSIS_ENGINE: 'heuristic',
      })
    ).toEqual([])
    expect(() => assertHostedWardrobeConfig(hosted)).not.toThrow()
  })

  it('TEA: refuses production with TEST_ENV=local and a fixture moderation selector', () => {
    // The bypass the guard exists for: the shared helper opens fixtures under TEST_ENV=local even
    // with NODE_ENV=production, so an ordinary photo would reach `ready` unmoderated.
    const env = {
      ...hosted,
      TEST_ENV: 'local',
      SILHOUETTE_MODERATION_ENGINE: 'fixture',
      PALETTE_ANALYSIS_ENGINE: 'fixture',
    }
    expect(allowsTestOnlySecrets(env)).toBe(true)
    const problems = hostedWardrobeConfigProblems(env)
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/^TEST_ENV=local is refused/)
    expect(problems.join(' ')).toMatch(/SILHOUETTE_MODERATION_ENGINE=fixture is refused/)
    expect(problems.join(' ')).toMatch(/PALETTE_ANALYSIS_ENGINE=fixture is refused/)
    expect(() => assertHostedWardrobeConfig(env)).toThrow(
      /Hosted wardrobe worker configuration refused: TEST_ENV=local is refused/
    )
  })

  it('TEA: the unguarded factory does build the fixture engine under that environment', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      TEST_ENV: process.env.TEST_ENV,
      engine: process.env.SILHOUETTE_MODERATION_ENGINE,
    }
    try {
      process.env.NODE_ENV = 'production'
      process.env.TEST_ENV = 'local'
      process.env.SILHOUETTE_MODERATION_ENGINE = 'fixture'
      expect(createSilhouetteModerationEngine()).toBeInstanceOf(
        FixtureSilhouettePhotoModerationEngine
      )
    } finally {
      for (const [key, value] of [
        ['NODE_ENV', saved.NODE_ENV],
        ['TEST_ENV', saved.TEST_ENV],
        ['SILHOUETTE_MODERATION_ENGINE', saved.engine],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it.each(['local', 'preview', 'ci', ' local '])('refuses TEST_ENV=%s alone', (value) => {
    const problems = hostedWardrobeConfigProblems({ ...hosted, TEST_ENV: value })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('TEST_ENV=')
  })

  it('refuses the fixture garment engine and any engine the model-free image cannot run', () => {
    expect(
      hostedWardrobeConfigProblems({ ...hosted, GARMENT_TAGGING_ENGINE: 'fixture' })
    ).toEqual(['GARMENT_TAGGING_ENGINE=fixture is refused on a hosted worker.'])
    expect(
      hostedWardrobeConfigProblems({ ...hosted, GARMENT_TAGGING_ENGINE: 'fashion-clip' })
    ).toEqual([
      expect.stringMatching(
        /carries no tagging model; set GARMENT_TAGGING_ENGINE=manual/
      ),
    ])
    expect(
      hostedWardrobeConfigProblems(
        { ...hosted, GARMENT_TAGGING_ENGINE: 'fashion-clip' },
        { modelFree: false }
      )
    ).toEqual([])
    expect(
      hostedWardrobeConfigProblems(
        { ...hosted, GARMENT_TAGGING_ENGINE: 'gpt-vision' },
        { modelFree: false }
      )
    ).toEqual([expect.stringMatching(/GARMENT_TAGGING_ENGINE=gpt-vision is refused/)])
  })

  it('refuses an unknown moderation or palette selector', () => {
    expect(
      hostedWardrobeConfigProblems({
        ...hosted,
        SILHOUETTE_MODERATION_ENGINE: 'gpt-vision',
      })
    ).toEqual([
      'SILHOUETTE_MODERATION_ENGINE=gpt-vision is not a supported selector; use heuristic.',
    ])
    expect(
      hostedWardrobeConfigProblems({ ...hosted, PALETTE_ANALYSIS_ENGINE: 'gpt-vision' })
    ).toEqual([
      'PALETTE_ANALYSIS_ENGINE=gpt-vision is not a supported selector; use heuristic.',
    ])
  })

  it.each(HOSTED_REQUIRED_ENV)('requires %s before any connection', (name) => {
    for (const value of [undefined, '', '  ']) {
      const problems = hostedWardrobeConfigProblems({ ...hosted, [name]: value })
      expect(problems).toContain(`${name} is required and is unset.`)
    }
  })

  it('requires the maintenance flag to be the literal true', () => {
    for (const value of [undefined, '', 'false', '1', 'yes']) {
      expect(
        hostedWardrobeConfigProblems({ ...hosted, WARDROBE_MAINTENANCE_ENABLED: value })
      ).toEqual([expect.stringMatching(/WARDROBE_MAINTENANCE_ENABLED is not true/)])
    }
  })

  it('names every problem in one error', () => {
    expect(() =>
      assertHostedWardrobeConfig({ NODE_ENV: 'production', TEST_ENV: 'local' })
    ).toThrow(/TEST_ENV=local is refused[\s\S]*DATABASE_URL is required[\s\S]*not true/)
  })
})

describe('the drill-child exemption', () => {
  const drillEnv = {
    ...ISOLATED_DRILL_ENV,
    GARMENT_TAGGING_ENGINE: 'manual',
  } as NodeJS.ProcessEnv

  it('exempts maintenance only in exactly the isolated drill configuration', () => {
    expect(isIsolatedDrillEnv(drillEnv)).toBe(true)
    expect(hostedWardrobeConfigProblems(drillEnv)).toHaveLength(1)
    expect(hostedWardrobeConfigProblems(drillEnv, { drillChild: true })).toEqual([])
  })

  it.each([
    ['a real database', { DATABASE_URL: hosted.DATABASE_URL }],
    ['a real Redis', { REDIS_URL: hosted.REDIS_URL }],
    ['a real Supabase project', { SUPABASE_URL: hosted.SUPABASE_URL }],
    ['a real service role key', { SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }],
  ])('exempts nothing when the drill flag meets %s', (_name, override) => {
    const env = { ...hosted, ...override, WARDROBE_MAINTENANCE_ENABLED: 'false' }
    expect(isIsolatedDrillEnv(env)).toBe(false)
    expect(hostedWardrobeConfigProblems(env, { drillChild: true })).toEqual([
      expect.stringMatching(/WARDROBE_MAINTENANCE_ENABLED is not true/),
    ])
  })

  it('still refuses a test profile or a fixture in the drill configuration', () => {
    expect(
      hostedWardrobeConfigProblems(
        { ...drillEnv, TEST_ENV: 'local', GARMENT_TAGGING_ENGINE: 'fixture' },
        { drillChild: true }
      )
    ).toHaveLength(2)
  })
})
