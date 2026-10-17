// Story 6.2 Task 8: every moderation reason the API can persist has author-facing
// copy. Web and mobile read `moderationReason` through the shared
// `COMMUNITY_MODERATION_REASON_CATEGORY` map, and a code missing from that map
// falls back to the raw string, which is how `text_policy_match` reached the
// author verbatim before this map existed. This spec makes that fallback
// reachable only by a moderator's free-text takedown reason.
import fs from 'node:fs'
import path from 'node:path'
import { COMMUNITY_MODERATION_REASON_CATEGORY } from '@couture/api-client/contracts/http'
import { describe, expect, it } from 'vitest'
import {
  IMAGE_DISPOSITION_CONFLICT_REASON,
  SCREENING_UNAVAILABLE_REASON,
} from '../src/modules/community/community-moderation.engine'
import {
  LOCALE_UNSCREENABLE_REASON,
  SCRIPT_MIXED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
  TEXT_INPUT_TRUNCATED_REASON,
  TEXT_POLICY_MATCH_REASON,
} from '../src/modules/community/community-text-screener'
import { NSFW_IMAGE_REASON_CODES } from '../src/modules/community/tensorflow-nsfw-image-screener'

const apiRoot = path.resolve(__dirname, '..')
const communitySource = path.join(apiRoot, 'src/modules/community')

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

/**
 * Literal codes the pipeline writes outside the policy: the maintenance sweep's
 * `moderation_reason: 'moderation_stalled'` and the processor's
 * `|| 'flagged_by_screening'` fallback for an empty reason list.
 */
function literalPipelineCodes(): string[] {
  return fs
    .readdirSync(communitySource)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(communitySource, name), 'utf8')
      return [
        ...source.matchAll(/moderation_reason:\s*'([a-z_]+)'/g),
        ...source.matchAll(/reasons\.join\([^)]*\)\s*\|\|\s*'([a-z_]+)'/g),
      ].map((match) => match[1] ?? '')
    })
}

describe('6.2 moderation reason copy coverage', () => {
  it('finds the literal codes it scans for, so an empty scan cannot pass', () => {
    expect(new Set(literalPipelineCodes())).toEqual(
      new Set(['moderation_stalled', 'flagged_by_screening'])
    )
  })

  it('gives every code the API can persist an author-facing category', () => {
    const emitted = new Set([
      ...policyReasonCodes(),
      ...literalPipelineCodes(),
      ...NSFW_IMAGE_REASON_CODES,
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
})
