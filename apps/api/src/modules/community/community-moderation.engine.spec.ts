// Learning path Step 38: Community feed by climate band.
// Story 6.1: Community moderation engine unit tests (ADR-013).
import { describe, expect, it, vi } from 'vitest'
import {
  ADR013_IMAGE_ENGINE_VERSION,
  ADR013_NSFW_CLASSES,
  ADR013_TEXT_ENGINE_VERSION,
  DefaultCommunityModerationEngine,
  FixtureCommunityModerationEngine,
  FIXTURE_IMAGE_ENGINE_VERSION,
  FIXTURE_TEXT_ENGINE_VERSION,
  IMAGE_DISPOSITION_CONFLICT_REASON,
  IMAGE_SCREENING_UNAVAILABLE_VERSION,
  imageCleared,
  LOCALE_UNSCREENABLE_REASON,
  SCREENING_UNAVAILABLE_REASON,
  UnavailableNsfwImageScreener,
  type ImageScreeningResult,
  type NsfwImageScreener,
} from './community-moderation.engine'
import { loadCommunityScreeningPolicy } from './community-screening-policy'
import {
  DEFAULT_COMMUNITY_TEXT_POLICY_VERSION,
  TEXT_CLEAN_REASON,
  TEXT_POLICY_MATCH_REASON,
} from './community-text-screener'

/** A stand-in for a real ADR-013 model, so the pass path is exercisable. */
class StubNsfwScreener implements NsfwImageScreener {
  readonly engineVersion = ADR013_IMAGE_ENGINE_VERSION
  constructor(private readonly verdict: Omit<ImageScreeningResult, 'engineVersion'>) {}
  screen(): Promise<ImageScreeningResult> {
    return Promise.resolve({ ...this.verdict, engineVersion: this.engineVersion })
  }
}

const cleanScreener = new StubNsfwScreener({ passed: true, reasons: [], score: 0.01 })
const nsfwScreener = new StubNsfwScreener({
  passed: false,
  reasons: ['nsfw'],
  score: 0.98,
})

describe('CommunityModerationEngine (ADR-013)', () => {
  const engine = new DefaultCommunityModerationEngine(cleanScreener)

  describe('text screening delegates to the reusable boundary', () => {
    // The dictionaries, the obfuscation families and the seven-language
    // coverage are `community-text-screener.spec.ts`'s subject. What is left to
    // prove here is that the engine hands each field to it correctly and folds
    // the answers without loosening either one.
    const engine = new DefaultCommunityModerationEngine(cleanScreener)

    it('screens each field as itself, because the field selects its ceiling', async () => {
      const caption = await engine.screenText({
        text: 'A classic autumn trench',
        field: 'caption',
        locale: 'en-US',
      })
      const altText = await engine.screenText({
        text: 'Full length photo of a trench coat outfit',
        field: 'altText',
        locale: 'en-US',
      })

      expect(caption.fields[0]?.field).toBe('caption')
      expect(altText.fields[0]?.field).toBe('altText')
    })

    it('runs every language whatever locale the client declared', async () => {
      const result = await engine.screenText({
        text: 'A classic autumn trench',
        field: 'caption',
        locale: 'en-US',
      })

      // A client-controlled locale must not be able to opt a submission out of
      // another language's list.
      expect([...result.screenedLanguages].sort()).toEqual([
        'de',
        'en',
        'es',
        'fr',
        'it',
        'pt',
        'tr',
      ])
    })

    it('holds a post whose declared locale has no list', async () => {
      const result = await engine.moderatePost({
        caption: 'A classic autumn trench',
        altText: 'Full length photo',
        locale: 'ja-JP',
        imageBuffer: Buffer.from('image'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toContain(LOCALE_UNSCREENABLE_REASON)
    })

    it('carries per-field provenance for both fields', async () => {
      const result = await engine.moderatePost({
        caption: 'A classic autumn trench',
        altText: 'Full length photo of a trench coat outfit',
        locale: 'en-US',
        imageBuffer: Buffer.from('image'),
      })

      expect(result.text.fields.map((field) => field.field)).toEqual([
        'caption',
        'altText',
      ])
      for (const field of result.text.fields) {
        expect(field.policyVersion).toBeTruthy()
        expect(field.observedScripts.length).toBeGreaterThan(0)
      }
    })

    it('exposes no matched terms anywhere in its result', async () => {
      // AC 4 keeps raw matched terms out of logs, metrics and evidence, and the
      // field that used to carry them is gone rather than emptied.
      const result = await engine.moderatePost({
        caption: 'A classic autumn trench',
        altText: 'Full length photo',
        locale: 'en-US',
        imageBuffer: Buffer.from('image'),
      })

      expect(JSON.stringify(result)).not.toContain('matchedTerms')
    })
  })

  describe('image screening fails closed without a model', () => {
    it('refuses any image when no NSFW screener is supplied', async () => {
      // The default engine is what production runs. ADR-013 names a
      // TensorFlow.js NSFW model that this repository does not carry, so the
      // honest verdict is "not screened", never "clean".
      const defaultEngine = new DefaultCommunityModerationEngine()
      const result = await defaultEngine.screenImage(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
      )

      expect(result.passed).toBe(false)
      expect(result.reasons).toEqual([SCREENING_UNAVAILABLE_REASON])
      expect(result.engineVersion).toBe(IMAGE_SCREENING_UNAVAILABLE_VERSION)
    })

    it('refuses a real-looking JPEG rather than defaulting it to clean', async () => {
      const screener = new UnavailableNsfwImageScreener()
      const jpegHeader = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(2048, 0x42),
      ])

      await expect(screener.screen(jpegHeader)).resolves.toMatchObject({
        passed: false,
        reasons: [SCREENING_UNAVAILABLE_REASON],
      })
    })

    it('delegates to the injected screener when one exists', async () => {
      const flagging = new DefaultCommunityModerationEngine(nsfwScreener)
      const result = await flagging.screenImage(Buffer.from('any bytes'))

      expect(result.passed).toBe(false)
      expect(result.reasons).toContain('nsfw')
      expect(result.score).toBeGreaterThan(0.9)
    })

    it('reports the unscreened image as review rather than block', async () => {
      // `review` is the queue a human already works. Reporting `block` would
      // claim the model saw something, when the only fact is that no model ran.
      const screener = new UnavailableNsfwImageScreener()
      const result = await screener.screen(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))

      expect(result.disposition).toBe('review')
      expect(result.passed).toBe(false)
      expect(result.reasons).toEqual([SCREENING_UNAVAILABLE_REASON])
    })
  })

  describe('three-way image disposition', () => {
    const verdict = (
      partial: Omit<ImageScreeningResult, 'engineVersion'>
    ): ImageScreeningResult => ({
      ...partial,
      engineVersion: ADR013_IMAGE_ENGINE_VERSION,
    })

    it('pins the five class names in the manifest order', () => {
      // The adapter applies these positionally to the model's output vector, so
      // reordering them relabels every probability it reads back.
      expect(ADR013_NSFW_CLASSES).toEqual([
        'Drawing',
        'Hentai',
        'Neutral',
        'Porn',
        'Sexy',
      ])
    })

    it('clears a passing image whose disposition is absent or pass', () => {
      expect(imageCleared(verdict({ passed: true, reasons: [] }))).toBe(true)
      expect(
        imageCleared(verdict({ passed: true, reasons: [], disposition: 'pass' }))
      ).toBe(true)
    })

    it('refuses a passing image whose disposition disagrees', () => {
      expect(
        imageCleared(verdict({ passed: true, reasons: [], disposition: 'review' }))
      ).toBe(false)
      expect(
        imageCleared(verdict({ passed: true, reasons: [], disposition: 'block' }))
      ).toBe(false)
    })

    it('refuses a failing image whatever its disposition claims', () => {
      expect(imageCleared(verdict({ passed: false, reasons: ['nsfw'] }))).toBe(false)
      expect(
        imageCleared(verdict({ passed: false, reasons: [], disposition: 'pass' }))
      ).toBe(false)
    })
  })

  describe('moderatePost combined evaluation', () => {
    const cleanPost = {
      caption: 'Clean stylish caption',
      altText: 'Clean alt text description',
      locale: 'en-US',
      imageBuffer: Buffer.from('bytes'),
    }

    it('returns passed only when text and image both clear', async () => {
      const result = await engine.moderatePost({
        caption: 'A wonderful autumn look',
        altText: 'Full body photo of trench coat and dark denim',
        locale: 'en-US',
        imageBuffer: Buffer.from('bytes'),
      })

      expect(result.outcome).toBe('passed')
      expect(result.reasons).toEqual([TEXT_CLEAN_REASON])
      expect(result.engineVersions).toEqual({
        text: DEFAULT_COMMUNITY_TEXT_POLICY_VERSION,
        image: ADR013_IMAGE_ENGINE_VERSION,
      })
    })

    it('records BOTH engine verdicts even when only one flags', async () => {
      const result = await engine.moderatePost({
        caption: 'What a piece of shit jacket',
        altText: 'Clean alt text description',
        locale: 'en-US',
        imageBuffer: Buffer.from('bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.text.passed).toBe(false)
      expect(result.image.passed).toBe(true)
      expect(result.reasons).toContain(TEXT_POLICY_MATCH_REASON)
    })

    it('flags a post whose alt text contains profanity but whose caption is clean', async () => {
      const result = await engine.moderatePost({
        caption: 'Clean stylish caption',
        altText: 'Photo of a fucking jacket',
        locale: 'en-US',
        imageBuffer: Buffer.from('bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toContain(TEXT_POLICY_MATCH_REASON)
    })

    it('flags a post with clean text when the image screener refuses it', async () => {
      const defaultEngine = new DefaultCommunityModerationEngine()
      const result = await defaultEngine.moderatePost({
        caption: 'Clean stylish caption',
        altText: 'Clean alt text description',
        locale: 'en-US',
        imageBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toEqual([SCREENING_UNAVAILABLE_REASON])
      expect(result.text.passed).toBe(true)
    })

    it('aggregates reasons when both text and image are flagged', async () => {
      const flagging = new DefaultCommunityModerationEngine(nsfwScreener)
      const result = await flagging.moderatePost({
        caption: 'Merde ce look',
        altText: 'Clean alt text',
        locale: 'fr-FR',
        imageBuffer: Buffer.from('bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toContain(TEXT_POLICY_MATCH_REASON)
      expect(result.reasons).toContain('nsfw')
    })

    it('refuses to publish when a screener passes an image it also blocks', async () => {
      // A screener saying `passed: true` beside a blocking disposition is
      // contradicting itself, and one of the two halves is wrong. Reading either
      // half alone publishes on whichever one that is, so both have to agree.
      const blocking = new DefaultCommunityModerationEngine(
        new StubNsfwScreener({ passed: true, reasons: [], disposition: 'block' })
      )
      const reviewing = new DefaultCommunityModerationEngine(
        new StubNsfwScreener({ passed: true, reasons: [], disposition: 'review' })
      )

      // The contradiction is named rather than left silent, so a held post does
      // not reach the moderation queue with nothing to explain it, and so the
      // reason points at the screener rather than at the image.
      await expect(blocking.moderatePost(cleanPost)).resolves.toMatchObject({
        outcome: 'flagged',
        reasons: [IMAGE_DISPOSITION_CONFLICT_REASON],
      })
      await expect(reviewing.moderatePost(cleanPost)).resolves.toMatchObject({
        outcome: 'flagged',
        reasons: [IMAGE_DISPOSITION_CONFLICT_REASON],
      })
    })

    it('refuses to publish when a screener fails an image it also passes', async () => {
      const contradicting = new DefaultCommunityModerationEngine(
        new StubNsfwScreener({ passed: false, reasons: ['nsfw'], disposition: 'pass' })
      )
      const result = await contradicting.moderatePost(cleanPost)

      expect(result.outcome).toBe('flagged')
      expect(result.image.disposition).toBe('pass')
    })

    it('flags a refusal that names no reason even when a disposition is present', async () => {
      const silent = new DefaultCommunityModerationEngine(
        new StubNsfwScreener({ passed: false, reasons: [], disposition: 'block' })
      )
      const result = await silent.moderatePost(cleanPost)

      expect(result.outcome).toBe('flagged')
      // Empty, and deliberately so. The image refused without explaining
      // itself, and the text half's `text_clean` marker comes off the combined
      // list once anything holds the post, so a moderator is never told the
      // post was held because the text was clean.
      expect(result.reasons).toEqual([])
      expect(result.text.reasons).toEqual([TEXT_CLEAN_REASON])
    })

    it('carries the model detail through onto result.image untouched', async () => {
      // The processor persists these for the access-controlled evaluation
      // payload, so anything the engine drops here cannot be recovered later.
      const classProbabilities = {
        Drawing: 0.01,
        Hentai: 0.002,
        Neutral: 0.95,
        Porn: 0.008,
        Sexy: 0.03,
      }
      const detailed = new DefaultCommunityModerationEngine(
        new StubNsfwScreener({
          passed: true,
          reasons: [],
          score: 0.03,
          disposition: 'pass',
          classProbabilities,
          policyVersion: 'sha256:0f1e2d3c',
        })
      )

      const result = await detailed.moderatePost(cleanPost)

      expect(result.outcome).toBe('passed')
      expect(result.image.classProbabilities).toEqual(classProbabilities)
      expect(result.image.policyVersion).toBe('sha256:0f1e2d3c')
      expect(result.image.disposition).toBe('pass')
    })
  })

  describe('policy alignment', () => {
    it('emits a conflict reason the approved policy actually declares', () => {
      // The engine holds the string as a constant rather than reading the
      // policy at screening time, so this is what stops the two drifting apart
      // and leaving a reason code nothing downstream can map to a disposition.
      const { policy } = loadCommunityScreeningPolicy()

      expect(policy.reasonCodes.image[IMAGE_DISPOSITION_CONFLICT_REASON]).toBe('review')
    })
  })

  describe('FixtureCommunityModerationEngine', () => {
    it('allows deterministic overrides for testing', async () => {
      const fixtureEngine = new FixtureCommunityModerationEngine({
        textOutcome: { passed: false, reasons: ['custom_text_violation'] },
        imageOutcome: { passed: true, reasons: [] },
      })

      const result = await fixtureEngine.moderatePost({
        caption: 'Normal caption',
        imageBuffer: Buffer.from('test-bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toEqual(['custom_text_violation'])
    })

    it('never signs the real model name onto a row it screened', async () => {
      // A `moderation_engine_version` outlives everyone who remembers which
      // engine was wired on the day, and it is the column an auditor reads to
      // answer "was this screened". This engine used to report
      // `adr013-nsfw-v1.0` verbatim, so every row it published claimed a real
      // ADR-013 screening on content no model had seen.
      const fixtureEngine = new FixtureCommunityModerationEngine({
        textOutcome: { passed: true, reasons: [] },
        imageOutcome: { passed: true, reasons: [] },
      })

      const result = await fixtureEngine.moderatePost({
        caption: 'Normal caption',
        altText: 'Normal alt text',
        locale: 'en-US',
        imageBuffer: Buffer.from('test-bytes'),
      })

      expect(result.engineVersions.image).toBe(FIXTURE_IMAGE_ENGINE_VERSION)
      expect(result.engineVersions.text).toBe(FIXTURE_TEXT_ENGINE_VERSION)
      expect(result.engineVersions.image).toContain('-fixture')
      expect(result.engineVersions.text).toContain('-fixture')
      expect(result.engineVersions.image).not.toBe(ADR013_IMAGE_ENGINE_VERSION)
      expect(result.engineVersions.text).not.toBe(ADR013_TEXT_ENGINE_VERSION)
    })

    it('keeps the REAL text version when no text outcome is pinned', async () => {
      // With no outcome configured it delegates to the genuine dictionary
      // screening, so the work really was done and claiming otherwise would be
      // the same dishonesty in the opposite direction.
      const fixtureEngine = new FixtureCommunityModerationEngine({
        imageOutcome: { passed: true, reasons: [] },
      })

      const result = await fixtureEngine.screenText({
        text: 'A clean caption',
        field: 'caption',
        locale: 'en-US',
      })

      // The screener's own policy version, and pointedly NOT a version carrying
      // the fixture marker: a delegated screening really happened.
      expect(result.engineVersion).toBe(DEFAULT_COMMUNITY_TEXT_POLICY_VERSION)
      expect(result.engineVersion).not.toBe(FIXTURE_TEXT_ENGINE_VERSION)
    })

    it('refuses to construct outside an allowed test environment', () => {
      const originalNodeEnv = process.env.NODE_ENV
      const originalTestEnv = process.env.TEST_ENV
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      try {
        expect(() => new FixtureCommunityModerationEngine()).toThrow(
          /strictly forbidden outside an allowed test environment/
        )
      } finally {
        process.env.NODE_ENV = originalNodeEnv
        if (originalTestEnv === undefined) {
          delete process.env.TEST_ENV
        } else {
          process.env.TEST_ENV = originalTestEnv
        }
      }
    })

    it('derives an image disposition from the pinned passed flag', async () => {
      const passing = new FixtureCommunityModerationEngine({
        imageOutcome: { passed: true, reasons: [] },
      })
      const failing = new FixtureCommunityModerationEngine({
        imageOutcome: { passed: false, reasons: ['nsfw'] },
      })
      const bytes = Buffer.from('test-bytes')

      await expect(passing.screenImage(bytes)).resolves.toMatchObject({
        disposition: 'pass',
      })
      await expect(failing.screenImage(bytes)).resolves.toMatchObject({
        disposition: 'review',
      })
    })

    it('holds a post whose pinned disposition contradicts its pinned pass', async () => {
      const fixtureEngine = new FixtureCommunityModerationEngine({
        textOutcome: { passed: true, reasons: [] },
        imageOutcome: { passed: true, reasons: [], disposition: 'block' },
      })

      const result = await fixtureEngine.moderatePost({
        caption: 'Normal caption',
        imageBuffer: Buffer.from('test-bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.image.disposition).toBe('block')
    })

    it('still fails closed on images when no image outcome is configured', async () => {
      // A fixture that quietly passed unconfigured images would reintroduce the
      // exact fail-open this suite exists to prevent.
      const fixtureEngine = new FixtureCommunityModerationEngine({
        textOutcome: { passed: true, reasons: [] },
      })

      const result = await fixtureEngine.moderatePost({
        caption: 'Normal caption',
        imageBuffer: Buffer.from('test-bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toEqual([SCREENING_UNAVAILABLE_REASON])
    })
  })

  describe('construction reaches no filesystem', () => {
    /**
     * The regression that took the API preview down. `CommunityModule` lists
     * `CommunityModerationProcessor` as a provider, so `NestFactory.create`
     * builds it during boot and its constructor builds this engine. While the
     * engine resolved its text screener eagerly, that boot read fourteen term
     * lists out of `apps/api/policies`, a directory outside `dist` reached
     * through `path.resolve(__dirname, ...)` that no import trace can follow and
     * that the serverless bundle therefore does not carry. Measured on
     * 2026-09-08 against the compiled Vercel entrypoint with the directory
     * hidden: `NestFactory.create` died with `term lists not found` and
     * `/api/health` 500ed, which is the `FUNCTION_INVOCATION_FAILED` the preview
     * workflow polled twenty times. Nothing in the request path screens text,
     * so the read belongs at first use.
     *
     * `vi.resetModules()` is load-bearing: the default screener is memoised at
     * module scope, so a sibling test that already screened would leave a cached
     * instance behind and let a re-broken constructor pass without reading
     * anything.
     */
    it('6.2-UNIT-040 builds its default screener on first use, not at construction', async () => {
      vi.resetModules()
      const engineModule = await import('./community-moderation.engine.js')
      const fsModule = await import('node:fs')
      const existsSync = vi.spyOn(fsModule.default, 'existsSync').mockReturnValue(false)

      try {
        const engine = new engineModule.DefaultCommunityModerationEngine()

        // With every candidate directory reported absent, a constructor that
        // resolved the screener would throw here the way boot did.
        expect(existsSync).not.toHaveBeenCalled()

        // And the read really is deferred rather than removed: the same absent
        // directory is still a hard failure the moment something screens.
        expect(() =>
          engine.screenText({ text: 'a linen dress', field: 'caption', locale: 'en-US' })
        ).toThrow(/term lists not found/)
      } finally {
        existsSync.mockRestore()
      }
    })
  })
})
