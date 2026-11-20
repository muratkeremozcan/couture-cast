import { createHash } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import type { CommunityTextScreener } from './community-text-screener.js'

let screener: Promise<CommunityTextScreener> | undefined

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
): Promise<{ passed: boolean; policyVersion: string }> {
  try {
    const textScreener = await requestTextScreener()
    const titleResult = textScreener.screen({ text: title, field: 'title', locale })
    const captionResult = textScreener.screen({ text: caption, field: 'caption', locale })
    return {
      passed: titleResult.disposition === 'pass' && captionResult.disposition === 'pass',
      policyVersion: titleResult.policyVersion,
    }
  } catch {
    throw new ServiceUnavailableException(
      'Community text screening is temporarily unavailable.'
    )
  }
}
