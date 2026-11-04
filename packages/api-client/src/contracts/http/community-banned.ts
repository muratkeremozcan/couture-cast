// Story 6.11 owner: the member's own ban refusal in `packages/api-client/src/contracts/http/community-banned.ts`.
// Community operations name this body in their 403 responses, and moderation contracts read the same
// enums, so it lives apart from both and neither imports the other for it.
import { z } from 'zod'
import './common'

export const moderationSanctionKindSchema = z.enum(['temporary', 'permanent'])
export type ModerationSanctionKind = z.infer<typeof moderationSanctionKindSchema>

export const moderationAppealStatusSchema = z.enum([
  'not_requested',
  'requested',
  'upheld',
  'overturned',
])
export type ModerationAppealStatus = z.infer<typeof moderationAppealStatusSchema>

/** Distinct from the rollout copy, because both clients still match 403 messages after reading `code`. */
export const COMMUNITY_BANNED_MESSAGE = 'Community access is suspended for this account.'

/** The member's view of their own ban. It names no reason, moderator, case or sanction id. */
export const communityBannedErrorSchema = z
  .object({
    statusCode: z.literal(403),
    code: z.literal('community_banned'),
    message: z.string().min(1),
    sanction: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('temporary'),
          expiresAt: z.string().datetime(),
          appealStatus: moderationAppealStatusSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('permanent'),
          expiresAt: z.null(),
          appealStatus: moderationAppealStatusSchema,
        })
        .strict(),
    ]),
  })
  .strict()
  .openapi('CommunityBannedError')
export type CommunityBannedError = z.infer<typeof communityBannedErrorSchema>
