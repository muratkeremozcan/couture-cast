// Story 1.2b candidate token owner: HMAC signing, 15-minute expiry and fail-closed secret resolution in `apps/api/src/modules/location-preferences/location-candidate-token.ts`
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

/** Story 1.2b: a search candidate stays savable for 15 minutes. */
export const LOCATION_CANDIDATE_TTL_MS = 15 * 60 * 1000
const MIN_SECRET_LENGTH = 32
const TEST_ONLY_SECRET = 'test-only-location-candidate-secret-at-least-32-bytes'

const candidatePayloadSchema = z
  .object({
    v: z.literal(1),
    city: z.string().min(1).max(120),
    region: z.string().min(1).max(120).nullable(),
    country: z.string().regex(/^[A-Z]{2}$/),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    expiresAt: z.number().int().positive(),
  })
  .strict()

/** The canonical fields a token signs. No member identity, no display label. */
export interface LocationCandidate {
  city: string
  region: string | null
  country: string
  latitude: number
  longitude: number
}

export class InvalidLocationCandidateError extends Error {
  constructor() {
    super('Location candidate is invalid or expired')
    this.name = 'InvalidLocationCandidateError'
  }
}

/**
 * `LOCATION_CANDIDATE_SECRET` signs candidates, like the other signed tokens.
 * Local and test runtimes fall back to a fixed test secret; anywhere else a
 * missing or short secret is null, which the endpoints answer with a 503.
 */
export function resolveLocationCandidateSecret(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): string | null {
  const configured = env.LOCATION_CANDIDATE_SECRET?.trim()
  if (configured && configured.length >= MIN_SECRET_LENGTH) {
    return configured
  }
  return allowsTestOnlySecrets(env) ? TEST_ONLY_SECRET : null
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`location-candidate:v1:${payload}`)
    .digest('base64url')
}

export function encodeLocationCandidate(
  candidate: LocationCandidate,
  secret: string,
  now: Date
): string {
  const payload = Buffer.from(
    JSON.stringify(
      candidatePayloadSchema.parse({
        v: 1,
        city: candidate.city,
        region: candidate.region,
        country: candidate.country,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        expiresAt: now.getTime() + LOCATION_CANDIDATE_TTL_MS,
      })
    )
  ).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Verifies the signature before reading anything, then the expiry. A bad
 * signature, another environment's secret and an expired token all fail alike.
 */
export function decodeLocationCandidate(
  token: string,
  secret: string,
  now: Date
): LocationCandidate {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) {
    throw new InvalidLocationCandidateError()
  }
  const expected = Buffer.from(sign(payload, secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new InvalidLocationCandidateError()
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidLocationCandidateError()
  }
  const parsed = candidatePayloadSchema.safeParse(decoded)
  if (!parsed.success || parsed.data.expiresAt <= now.getTime()) {
    throw new InvalidLocationCandidateError()
  }

  return {
    city: parsed.data.city,
    region: parsed.data.region,
    country: parsed.data.country,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
  }
}
