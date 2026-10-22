// Story 6.5 owner (D6): an intent qualifies only for a current, opted-in recipient with a
// valid account policy, and never after it expires.
import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const repository = new CommunityRepository(prisma)
const worker = new CommunityNotificationsWorker(prisma, {
  dispatch: () => Promise.resolve(),
})

beforeAll(async () => {
  await database.migrate()
}, 60_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

const active = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
/** Preference rows sit behind the privacy entry guard, as every production writer does. */
function guarded(
  member: string,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${member}]::text[],ARRAY[]::text[],true)`
    await work(tx)
  })
}
/** An opted-in recipient whose post an actor reacts to, leaving one ungrouped intent. */
async function pendingIntent() {
  const recipient = await active()
  const actor = await active()
  await guarded(recipient.id, async (tx) => {
    await tx.notificationPreference.create({ data: { user_id: recipient.id } })
    await tx.communityNotificationPreference.create({
      data: { user_id: recipient.id, enabled: true },
    })
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: recipient.id, status: 'published' })
    ),
  })
  await repository.setReaction({
    userId: actor.id,
    postId: post.id,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  const intent = await prisma.communityNotificationIntent.findFirstOrThrow({
    where: { recipient_id: recipient.id },
  })
  return { recipient, intent }
}
const settled = (id: string) =>
  prisma.communityNotificationIntent.findUniqueOrThrow({ where: { id } })

describe('intent qualification', () => {
  it('qualifies a current opted-in recipient into a group', async () => {
    const { intent } = await pendingIntent()
    await worker.group()
    expect(await settled(intent.id)).toMatchObject({ deliverable: true })
    expect((await settled(intent.id)).group_id).not.toBeNull()
  })

  it.each([
    [
      'the member opted out',
      (member: string) =>
        guarded(member, (tx) =>
          tx.communityNotificationPreference.update({
            where: { user_id: member },
            data: { enabled: false },
          })
        ),
    ],
    [
      'the preference changed since the intent was recorded',
      (member: string) =>
        guarded(member, (tx) =>
          tx.communityNotificationPreference.update({
            where: { user_id: member },
            data: { generation: { increment: 1 } },
          })
        ),
    ],
    [
      'the account policy is gone',
      (member: string) =>
        guarded(member, (tx) =>
          tx.notificationPreference.delete({ where: { user_id: member } })
        ),
    ],
    [
      'the quiet hours are not a valid window',
      (member: string) =>
        guarded(member, (tx) =>
          tx.notificationPreference.update({
            where: { user_id: member },
            data: {
              quiet_hours_enabled: true,
              quiet_hours_start: '22:00',
              quiet_hours_end: '22:00',
            },
          })
        ),
    ],
  ] as const)('withdraws the intent when %s', async (_label, change) => {
    const { recipient, intent } = await pendingIntent()
    await change(recipient.id)
    await worker.group()
    expect(await settled(intent.id)).toMatchObject({ deliverable: false, group_id: null })
  })

  it('never groups an intent that has already expired', async () => {
    const { intent } = await pendingIntent()
    await prisma.communityNotificationIntent.update({
      where: { id: intent.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    })
    await worker.group()
    expect((await settled(intent.id)).group_id).toBeNull()
  })
})
