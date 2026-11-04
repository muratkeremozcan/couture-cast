// Story 6.10 owner: every table a moderation read touches, in `apps/api/src/modules/moderation/moderation-queue-tables.ts`.
// This file has no imports on purpose: the RLS suite in `packages/db` iterates it without loading Nest or Prisma.

/**
 * The RLS suite proves that `anon` and `authenticated` are denied on each table, so a table added
 * to a query cannot escape the proof. `AuditLog` is written, never read, and is guarded by its own
 * immutability migration.
 */
export const MODERATION_QUEUE_READ_TABLES = Object.freeze([
  'CommunityPostReport',
  'CommunityCommentReport',
  'LookbookPost',
  'CommunityComment',
  'CommunityAlias',
  'ModerationEvent',
  'CommunityCommentAudit',
] as const)
