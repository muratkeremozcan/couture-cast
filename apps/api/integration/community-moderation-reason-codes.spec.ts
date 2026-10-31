// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2 Task 8: every moderation reason the API can persist has author-facing
// copy. Web and mobile read `moderationReason` through the shared
// `COMMUNITY_MODERATION_REASON_CATEGORY` map, and a code missing from that map
// falls back to the raw string, which is how `text_policy_match` reached the
// author verbatim before this map existed. This spec makes that fallback
// reachable only by a moderator's free-text takedown reason.
//
// Story 6.2b review (RF12): the codes come from what the pipeline declares,
// not from a scan of literal assignments. A literal scan missed the image
// validation codes, which the processor persists from the error it caught;
// they now come from `communityImageValidationCodeSchema`, the enumeration the
// validation throws.
import fs from 'node:fs'
import path from 'node:path'
import {
  COMMUNITY_MODERATION_REASON_CATEGORY,
  communityImageValidationCodeSchema,
  communityModerationReasonCategories,
} from '@couture/api-client/contracts/http'
import { describe, expect, it } from 'vitest'
import { MODERATION_STALLED_REASON } from '../src/modules/community/community-maintenance.service'
import {
  IMAGE_DISPOSITION_CONFLICT_REASON,
  SCREENING_UNAVAILABLE_REASON,
} from '../src/modules/community/community-moderation.engine'
import { FLAGGED_BY_SCREENING_REASON } from '../src/modules/community/community-moderation.processor'
import {
  LOCALE_UNSCREENABLE_REASON,
  SCRIPT_MIXED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
  TEXT_INPUT_TRUNCATED_REASON,
  TEXT_POLICY_MATCH_REASON,
} from '../src/modules/community/community-text-screener'
import { NSFW_IMAGE_REASON_CODES } from '../src/modules/community/tensorflow-nsfw-image-screener'

const apiRoot = path.resolve(__dirname, '..')

/** Reason codes declared by every committed screening policy. */
function policyReasonCodes(): string[] {
  const directory = path.join(apiRoot, 'policies/community-screening')
  return fs
    .readdirSync(directory)
    .filter((name) => /^policy-v\d+\.json$/.test(name))
    .flatMap((name) => {
      const policy = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as {
        reasonCodes: { image: Record<string, string>; text: Record<string, string> }
      }
      return [
        ...Object.keys(policy.reasonCodes.image),
        ...Object.keys(policy.reasonCodes.text),
      ]
    })
}

describe('6.2 moderation reason copy coverage', () => {
  it('gives every code the API can persist an author-facing category', () => {
    const emitted = new Set([
      ...policyReasonCodes(),
      ...communityImageValidationCodeSchema.options,
      ...NSFW_IMAGE_REASON_CODES,
      MODERATION_STALLED_REASON,
      FLAGGED_BY_SCREENING_REASON,
      SCREENING_UNAVAILABLE_REASON,
      IMAGE_DISPOSITION_CONFLICT_REASON,
      TEXT_POLICY_MATCH_REASON,
      TEXT_INPUT_TRUNCATED_REASON,
      LOCALE_UNSCREENABLE_REASON,
      SCRIPT_MIXED_REASON,
      SCRIPT_UNSUPPORTED_REASON,
    ])
    const uncovered = [...emitted].filter(
      (code) => !Object.hasOwn(COMMUNITY_MODERATION_REASON_CATEGORY, code)
    )
    expect(uncovered).toEqual([])
  })

  it('tells the author to upload again for every image validation failure', () => {
    // Story 6.2b review (RF12): these five reached authors as raw codes.
    for (const code of communityImageValidationCodeSchema.options) {
      expect({ code, categories: communityModerationReasonCategories(code) }).toEqual({
        code,
        categories: ['upload'],
      })
    }
  })
})
