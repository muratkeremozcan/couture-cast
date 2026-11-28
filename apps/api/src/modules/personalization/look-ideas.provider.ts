import {
  MEMBER_LOOKBOOK_DESCRIPTION_CHOICES,
  type memberLookbookRankingCandidates,
} from '@couture/utils'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { LookIdeasInput } from '../../contracts/http.js'

export const LOOK_IDEA_PROVIDER = Symbol('LOOK_IDEA_PROVIDER')
export const LOOK_IDEA_MODEL = 'anthropic/claude-haiku-5.5'

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const MAX_COMPLETION_BYTES = 32_768
const SYSTEM_PROMPT = [
  'Rank the three catalog outfits from best to least suited to the supplied weather and style choices.',
  'Catalog inputs give each outfit ID and the garment ID in each slot.',
  'Return each outfit ID exactly once in ranked order. Preserve the catalog selections.',
  'Choose an approved clothing description for each outfit. Mention weather only when it matches the input.',
  'Describe the clothes and weather. Exclude all statements about the wearer.',
].join(' ')

const completionSchema = z.object({
  choices: z.tuple([
    z.object({
      finish_reason: z.literal('stop'),
      message: z.object({ content: z.string().max(1_024) }),
    }),
  ]),
})

export type LookIdeaProviderInput = LookIdeasInput & {
  candidates: ReturnType<typeof memberLookbookRankingCandidates>
}

export interface LookIdeaProvider {
  readonly enabled?: boolean
  generate(input: LookIdeaProviderInput, signal: AbortSignal): Promise<unknown>
}

function gatewayKey(env: NodeJS.ProcessEnv): string | undefined {
  const testEnv = env.TEST_ENV?.trim().toLowerCase()
  if (
    env.LOOK_IDEAS_ENABLED !== 'true' ||
    (env.CI && env.CI !== 'false') ||
    env.NODE_ENV === 'test' ||
    testEnv === 'local' ||
    testEnv === 'preview' ||
    testEnv === 'test' ||
    env.VERCEL_ENV === 'preview'
  )
    return undefined
  return env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || undefined
}

@Injectable()
export class GatewayLookIdeaProvider implements LookIdeaProvider {
  get enabled() {
    return Boolean(gatewayKey(process.env))
  }

  async generate(input: LookIdeaProviderInput, signal: AbortSignal): Promise<unknown> {
    const key = gatewayKey(process.env)
    if (!key) return null

    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      redirect: 'error',
      signal,
      body: JSON.stringify({
        model: LOOK_IDEA_MODEL,
        max_tokens: 400,
        reasoning: { effort: 'none' },
        providerOptions: {
          gateway: {
            only: ['anthropic'],
            zeroDataRetention: true,
            disallowPromptTraining: true,
          },
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'look_ideas',
            strict: true,
            schema: {
              type: 'object',
              required: ['ideas'],
              additionalProperties: false,
              properties: {
                ideas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['lookId', 'description'],
                    additionalProperties: false,
                    properties: {
                      lookId: {
                        type: 'string',
                        enum: input.candidates.map(({ lookId }) => lookId),
                      },
                      description: {
                        type: 'string',
                        enum: MEMBER_LOOKBOOK_DESCRIPTION_CHOICES,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    })

    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Look ideas provider request failed')
    }
    const completion = completionSchema.parse(await readCompletion(response))
    return JSON.parse(completion.choices[0].message.content)
  }
}

async function readCompletion(response: Response): Promise<unknown> {
  const body = response.body
  if (!body) throw new Error('Look ideas provider returned an empty response')
  if (Number(response.headers.get('content-length')) > MAX_COMPLETION_BYTES) {
    await body.cancel()
    throw new Error('Look ideas provider response exceeded the size limit')
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_COMPLETION_BYTES) {
        await reader.cancel()
        throw new Error('Look ideas provider response exceeded the size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
}
