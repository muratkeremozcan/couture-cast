import { createHash } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import { COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE } from '@couture/api-client/contracts/http'
import type { CommunityTextScreener } from './community-text-screener.js'

let screener: Promise<CommunityTextScreener> | undefined

export interface NormalizedPostText {
  readonly title: string | null
  readonly caption: string | null
  readonly textFingerprint: string
}

export interface ScreenedPostTextDecision {
  readonly passed: boolean
  readonly policyVersion: string
  readonly textFingerprint?: string
  readonly locale?: string | null
}

export function normalizePostText(
  title: string | null | undefined,
  caption: string | null | undefined
): NormalizedPostText {
  const normalizedTitle = title?.trim() || null
  const normalizedCaption = caption?.trim() || null
  return {
    title: normalizedTitle,
    caption: normalizedCaption,
    textFingerprint: postTextFingerprint(normalizedTitle, normalizedCaption),
  }
}

export function postTextFingerprint(
  title: string | null,
  caption: string | null
): string {
  return createHash('sha256')
    .update(JSON.stringify([title, caption]))
    .digest('hex')
}

function requestTextScreener() {
  // Vercel's CommonJS loader cannot require the profanity package's ESM
  // dependency. Enter through its ESM export and inject a fresh filter.
  screener ??= Promise.all([
    import('bad-words'),
    import('./community-text-screener.js'),
    import('./community-screening-policy.js'),
  ])
    .then(([{ Filter }, { CommunityTextScreener }, { loadCommunityScreeningPolicy }]) => {
      const loaded = loadCommunityScreeningPolicy()
      return new CommunityTextScreener({
        policy: loaded.policy.text,
        policyVersion: loaded.identity.textEngineVersion,
        englishFilter: new Filter(),
      })
    })
    .catch((error: unknown) => {
      screener = undefined
      throw error
    })
  return screener
}

export async function screenPostText(
  title: string | null,
  caption: string | null,
  locale: string | null
): Promise<Required<ScreenedPostTextDecision>> {
  const normalized = normalizePostText(title, caption)
  try {
    const textScreener = await requestTextScreener()
    const titleResult = textScreener.screen({
      text: normalized.title,
      field: 'title',
      locale,
    })
    const captionResult = textScreener.screen({
      text: normalized.caption,
      field: 'caption',
      locale,
    })
    return {
      passed: titleResult.disposition === 'pass' && captionResult.disposition === 'pass',
      policyVersion: titleResult.policyVersion,
      textFingerprint: normalized.textFingerprint,
      locale,
    }
  } catch {
    throw new ServiceUnavailableException(
      COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE
    )
  }
}
