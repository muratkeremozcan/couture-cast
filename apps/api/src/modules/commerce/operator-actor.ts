// Story 6.14: the owner operator's admin check, shared by the sponsorship (6.7b) and complimentary
// access (6.14) commands. Moved here unchanged from community-sponsorship-operator.service.ts.
import { Prisma } from '@prisma/client'
import { z } from 'zod'

export type OperatorActorRefusalCode =
  | 'actor_auth_user_missing'
  | 'actor_not_admin'
  | 'actor_app_user_missing'
  | 'actor_identity_mismatch'

const authUserRowSchema = z.object({
  email: z.string().nullable(),
  raw_app_meta_data: z.record(z.unknown()).nullable(),
})

/**
 * The acting owner, resolved in the same Postgres the command writes to.
 *
 * The Supabase auth user's `app_metadata.app_role` must be `admin`, the same
 * claim the API authorizes requests on. It maps to the app `User` through
 * `app_metadata.app_user_id`, or by email when that is absent, and the two
 * identities must name the same email. Any gap refuses through `refuse`, so each
 * command keeps its own refusal class.
 */
export async function resolveOperatorAdmin(
  tx: Prisma.TransactionClient,
  actorEmail: string,
  refuse: (code: OperatorActorRefusalCode, message: string) => Error
): Promise<string> {
  const email = actorEmail.trim().toLowerCase()
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT email, raw_app_meta_data
    FROM auth.users
    WHERE lower(email) = ${email}
  `)
  if (rows.length !== 1) {
    throw refuse('actor_auth_user_missing', 'No single auth user has that --actor-email.')
  }
  const authUser = authUserRowSchema.parse(rows[0])
  const appMetadata = authUser.raw_app_meta_data ?? {}
  if (appMetadata.app_role !== 'admin') {
    throw refuse(
      'actor_not_admin',
      'The --actor-email auth user does not carry app_role admin.'
    )
  }

  const appUserId =
    typeof appMetadata.app_user_id === 'string' && appMetadata.app_user_id.trim()
      ? appMetadata.app_user_id.trim()
      : undefined
  const appUser = await tx.user.findUnique({
    where: appUserId ? { id: appUserId } : { email },
    select: { id: true, email: true },
  })
  if (!appUser) {
    throw refuse('actor_app_user_missing', 'The --actor-email auth user has no app user.')
  }
  if (appUser.email.toLowerCase() !== email) {
    throw refuse(
      'actor_identity_mismatch',
      'The auth user and its app user name different emails.'
    )
  }
  return appUser.id
}
