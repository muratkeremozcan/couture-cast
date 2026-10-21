import { z } from 'zod'
// Story 6.5 owner: actual-instant quiet hours, immutable deadlines and provider outcome policy.
export type QuietHours = {
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
}
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export function nextAllowedCommunityInstant(
  policy: QuietHours,
  now: Date,
  expiresAt: Date
):
  | { status: 'allowed' | 'deferred'; at: Date }
  | { status: 'expired' | 'invalid_policy' } {
  if (now >= expiresAt) return { status: 'expired' }
  if (!policy.quietHoursEnabled) return { status: 'allowed', at: now }
  if (
    !time.test(policy.quietHoursStart) ||
    !time.test(policy.quietHoursEnd) ||
    policy.quietHoursStart === policy.quietHoursEnd ||
    !policy.timezone.trim()
  )
    return { status: 'invalid_policy' }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: policy.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    return { status: 'invalid_policy' }
  }
  const quiet = (instant: Date) => {
    const parts = formatter.formatToParts(instant)
    const local = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`
    return policy.quietHoursStart < policy.quietHoursEnd
      ? local >= policy.quietHoursStart && local < policy.quietHoursEnd
      : local >= policy.quietHoursStart || local < policy.quietHoursEnd
  }
  if (!quiet(now)) return { status: 'allowed', at: now }
  // Walk UTC minutes. DST gaps cannot invent instants; repeated local minutes retain policy.
  const firstMinute = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000
  for (let instant = firstMinute; instant < expiresAt.getTime(); instant += 60_000) {
    const candidate = new Date(instant)
    if (!quiet(candidate)) return { status: 'deferred', at: candidate }
  }
  return { status: 'expired' }
}
export function communityPushCopy(locale: unknown, multiple: boolean) {
  const language = typeof locale === 'string' ? locale.split('-')[0]?.toLowerCase() : 'en'
  if (language === 'es')
    return {
      title: 'CoutureCast',
      body: multiple
        ? 'Hay nuevas interacciones en tu publicación.'
        : 'Tu publicación tiene una nueva interacción.',
    }
  if (language === 'fr')
    return {
      title: 'CoutureCast',
      body: multiple
        ? 'De nouvelles interactions sur votre publication.'
        : 'Une nouvelle interaction sur votre publication.',
    }
  return {
    title: 'CoutureCast',
    body: multiple
      ? 'There is new engagement on your post.'
      : 'Your post has new engagement.',
  }
}
export type CommunityPushOutcome =
  | { status: 'accepted'; ticketId: string }
  | { status: 'retryable_rejection'; reason: 'rate_limited' }
  | { status: 'invalid_token'; reason: 'device_not_registered' }
  | { status: 'failed'; reason: 'configuration' | 'invalid_payload' }
  | { status: 'unknown'; reason: 'ambiguous_response' | 'transport' }
const ticketSchema = z.object({
  status: z.enum(['ok', 'error']),
  id: z.string().min(1).optional(),
  details: z.object({ error: z.string() }).optional(),
})
const rejectionOutcomes = new Map<string, CommunityPushOutcome>([
  ['DeviceNotRegistered', { status: 'invalid_token', reason: 'device_not_registered' }],
  ['MessageRateExceeded', { status: 'retryable_rejection', reason: 'rate_limited' }],
  ['MessageTooBig', { status: 'failed', reason: 'invalid_payload' }],
  ['InvalidCredentials', { status: 'failed', reason: 'configuration' }],
])
export function classifyCommunityTicket(value: unknown): CommunityPushOutcome {
  const parsed = ticketSchema.safeParse(value)
  if (!parsed.success) return { status: 'unknown', reason: 'ambiguous_response' }
  const ticket = parsed.data
  if (ticket.status === 'ok' && ticket.id)
    return { status: 'accepted', ticketId: ticket.id }
  if (ticket.status === 'error' && ticket.details) {
    const classified = rejectionOutcomes.get(ticket.details.error)
    if (classified) return classified
  }
  return { status: 'unknown', reason: 'ambiguous_response' }
}
