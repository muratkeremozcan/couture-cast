import {
  createMemberLookbook,
  memberLookbookRankingCandidates,
  memberLookbookRankingSchema,
  validateMemberLookbookRanking,
} from '@couture/utils'
import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { LookIdeasInput, LookIdeasResponse } from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  LOOK_IDEA_BUDGET,
  LOOK_IDEA_DEADLINE_MS,
  type LookIdeaBudget,
} from './look-ideas.budget.js'
import { LOOK_IDEA_PROVIDER, type LookIdeaProvider } from './look-ideas.provider.js'

const providerOutput = z.strictObject({ ideas: memberLookbookRankingSchema })
const timedOut = Symbol('timeout')

@Injectable()
export class LookIdeasService {
  private readonly logger = createBaseLogger({
    includeRequestMetadata: false,
    productionLevel: 'info',
  })

  constructor(
    @Inject(LOOK_IDEA_PROVIDER) private readonly provider: LookIdeaProvider,
    @Inject(LOOK_IDEA_BUDGET) private readonly budget: LookIdeaBudget
  ) {}

  async generate(
    userId: string,
    input: LookIdeasInput
  ): Promise<LookIdeasResponse['data']> {
    const started = performance.now()
    const endsAt = started + LOOK_IDEA_DEADLINE_MS
    let outcome = 'unavailable'
    const request = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      if (this.provider.enabled === false) {
        outcome = 'disabled'
        return null
      }
      const candidates = memberLookbookRankingCandidates(
        createMemberLookbook(input.weather, input)
      )
      if (new Set(candidates.map(({ lookId }) => lookId)).size !== 3) return null

      const remaining = () => endsAt - performance.now()
      const deadline = new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => {
          resolve(timedOut)
          request.abort()
        }, remaining())
      })
      const reserved = await Promise.race([
        this.budget.reserve(userId, { at: endsAt, signal: request.signal }),
        deadline,
      ])
      outcome = reserved === timedOut || remaining() <= 0 ? 'timeout' : reserved
      if (outcome !== 'allowed') return null

      outcome = 'provider_error'
      const output = await Promise.race([
        this.provider.generate({ ...input, candidates }, request.signal),
        deadline,
      ])
      if (output === timedOut || remaining() <= 0) {
        outcome = 'timeout'
        request.abort()
        return null
      }
      const parsed = providerOutput.safeParse(output)
      const ranking = parsed.success
        ? validateMemberLookbookRanking(parsed.data.ideas, candidates, input.weather)
        : null
      outcome = ranking ? 'generated' : 'rejected'
      return ranking
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      this.logger.info(
        { outcome, durationMs: Math.round(performance.now() - started) },
        'look_ideas_generation'
      )
    }
  }
}
