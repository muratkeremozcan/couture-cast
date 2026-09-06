import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import {
  ADR013_IMAGE_ENGINE_VERSION,
  type ImageScreeningResult,
  type NsfwImageScreener,
} from './community-moderation.engine.js'

/** The environment variable that selects the image screener, mirroring `GARMENT_TAGGING_ENGINE`. */
export const COMMUNITY_NSFW_SCREENER_ENV = 'COMMUNITY_NSFW_SCREENER'

/** The only value that selects this fixture. Anything absent means the real screener. */
export const COMMUNITY_NSFW_SCREENER_FIXTURE = 'fixture'

/**
 * A screener that clears every image, for test environments only.
 *
 * A PASSING VERDICT FROM THIS PROVES NOTHING ABOUT IMAGE SAFETY. It does not
 * look at the bytes. Its only purpose is to make the story's published path
 * reachable at all: with the real ADR-013 model absent, every post terminates at
 * `flagged`, so nothing in this repository can exercise "publication and
 * concurrent feed paging, a post appearing exactly once under `published_at,id`
 * ordering after moderation completes". Asserting `flagged` everywhere instead
 * would quietly redefine the feature as "posts get reviewed" rather than "posts
 * get published". A green end-to-end run that used this is evidence about the
 * pipeline, never about the model.
 *
 * The constructor refuses to build unless BOTH the variable selects it and the
 * process is in an allowed test environment, the same double gate
 * `FixtureGarmentTaggingEngine` uses. `allowsTestOnlySecrets()` is deliberately
 * the same predicate the wardrobe fixture engine and
 * `scripts/local-e2e-database.mjs` use, so the three places that decide "is this
 * a throwaway environment" cannot disagree.
 */
export class FixtureNsfwImageScreener implements NsfwImageScreener {
  readonly engineVersion = `${ADR013_IMAGE_ENGINE_VERSION}-fixture`

  constructor() {
    if (
      process.env[COMMUNITY_NSFW_SCREENER_ENV]?.trim() !==
        COMMUNITY_NSFW_SCREENER_FIXTURE ||
      !allowsTestOnlySecrets()
    ) {
      throw new Error(
        'FixtureNsfwImageScreener is strictly forbidden outside an allowed test environment'
      )
    }
  }

  screen(_imageBuffer: Buffer): Promise<ImageScreeningResult> {
    void _imageBuffer
    return Promise.resolve({
      passed: true,
      reasons: [],
      engineVersion: this.engineVersion,
      score: 0,
    })
  }
}
