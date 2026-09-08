// Learning path Step 38: Community feed by climate band.
// Story 6.1: Community moderation engine unit tests (ADR-013).
import { describe, expect, it } from 'vitest'
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
  normalizeTextForModeration,
  resolveScreeningLanguage,
  SCREENING_UNAVAILABLE_REASON,
  UnavailableNsfwImageScreener,
  type ImageScreeningResult,
  type NsfwImageScreener,
} from './community-moderation.engine'

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

  describe('screenable language resolution and normalization', () => {
    it('returns null for a locale this engine holds no dictionary for', () => {
      // The old `resolveLanguage` mapped every unknown locale to `en`, which let a
      // client declare `de-DE` and switch the Spanish and French dictionaries off
      // for Spanish and French content.
      expect(resolveScreeningLanguage('de-DE')).toBeNull()
      expect(resolveScreeningLanguage('tr-TR')).toBeNull()
      expect(resolveScreeningLanguage('it-IT')).toBeNull()
      expect(resolveScreeningLanguage('pt-BR')).toBeNull()
      expect(resolveScreeningLanguage(null)).toBeNull()
      expect(resolveScreeningLanguage('')).toBeNull()
    })

    it('resolves the three languages with dictionaries', () => {
      expect(resolveScreeningLanguage('en-US')).toBe('en')
      expect(resolveScreeningLanguage('es-419')).toBe('es')
      expect(resolveScreeningLanguage('fr-CA')).toBe('fr')
    })

    it('normalizes text and strips diacritics', () => {
      expect(normalizeTextForModeration('Héllo WÖRLD')).toBe('hello world')
      expect(normalizeTextForModeration('Coño')).toBe('cono')
    })
  })

  describe('text screening runs every dictionary regardless of declared locale', () => {
    it('passes a clean caption', async () => {
      const result = await engine.screenText(
        'Layered wool coat with Chelsea boots for temperate weather',
        'en-US'
      )
      expect(result.passed).toBe(true)
      expect(result.reasons).toEqual([])
      expect(result.engineVersion).toBe(ADR013_TEXT_ENGINE_VERSION)
      expect(result.screenedLanguages).toEqual(['en', 'es', 'fr'])
    })

    it('does not false-positive on innocent substrings', async () => {
      const result = await engine.screenText(
        'A classic trench coat with passport pocket and brass buttons',
        'en'
      )
      expect(result.passed).toBe(true)
      expect(result.reasons).toEqual([])
    })

    it('flags Spanish profanity even when the client declares en-US', async () => {
      // This is the attack the old locale-driven dictionary allowed: declare a
      // locale whose dictionary does not contain the words you are using.
      const result = await engine.screenText('Menuda mierda de impermeable', 'en-US')
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain('profanity')
      expect(result.matchedTerms).toContain('mierda')
    })

    it('flags French profanity even when the client declares es-419', async () => {
      const result = await engine.screenText('Putain quel style magnifique', 'es-419')
      expect(result.passed).toBe(false)
      expect(result.matchedTerms).toContain('putain')
    })

    it('flags English profanity case-insensitively', async () => {
      const result = await engine.screenText('This outfit is FUCKING amazing', 'en')
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain('profanity')
      expect(result.matchedTerms).toContain('fucking')
    })

    it('flags English safety violations', async () => {
      const result = await engine.screenText('Go kill yourself right now', 'en')
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain('safety')
      expect(result.matchedTerms).toContain('kill yourself')
    })

    it('flags Spanish profanity with diacritics normalized', async () => {
      const result = await engine.screenText('Qué coño me pongo hoy', 'es-419')
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain('profanity')
    })

    it('flags Spanish and French safety terms', async () => {
      const spanish = await engine.screenText('eres un maricon', 'es-419')
      expect(spanish.passed).toBe(false)
      expect(spanish.reasons).toContain('safety')

      const french = await engine.screenText('sale nazi', 'fr-FR')
      expect(french.passed).toBe(false)
      expect(french.reasons).toContain('safety')
    })

    it('fails closed for a supported locale with no dictionary', async () => {
      // `de`, `tr`, `it` and `pt` are all shipped locales with no dictionary. A
      // clean-looking caption in one of them has NOT been screened, so it must
      // not pass; it goes to human review instead.
      const result = await engine.screenText('Ein schöner Mantel für den Herbst', 'de-DE')
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain(LOCALE_UNSCREENABLE_REASON)
    })

    it('fails closed for an unscreenable locale even with empty text', async () => {
      const result = await engine.screenText('', 'tr-TR')
      expect(result.passed).toBe(false)
      expect(result.reasons).toEqual([LOCALE_UNSCREENABLE_REASON])
    })

    it('passes empty text in a screenable locale', async () => {
      const result = await engine.screenText('', 'en-US')
      expect(result.passed).toBe(true)
      expect(result.reasons).toEqual([])
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
      expect(result.reasons).toEqual([])
      expect(result.engineVersions).toEqual({
        text: ADR013_TEXT_ENGINE_VERSION,
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
      expect(result.reasons).toContain('profanity')
    })

    it('flags a post whose alt text contains profanity but whose caption is clean', async () => {
      const result = await engine.moderatePost({
        caption: 'Clean stylish caption',
        altText: 'Photo of a fucking jacket',
        locale: 'en-US',
        imageBuffer: Buffer.from('bytes'),
      })

      expect(result.outcome).toBe('flagged')
      expect(result.reasons).toContain('profanity')
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
      expect(result.reasons).toContain('profanity')
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
      expect(result.reasons).toEqual([])
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

      const result = await fixtureEngine.screenText('A clean caption', 'en-US')

      expect(result.engineVersion).toBe(ADR013_TEXT_ENGINE_VERSION)
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
})
