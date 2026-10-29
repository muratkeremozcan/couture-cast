// Repeat safety of the community notification transactions against a real Postgres.
// The pldbgapi2 abort is injected two ways: a proxy that aborts the first run of a
// transaction after its callback (Postgres rolls the run back), and PL/pgSQL that
// raises the exact SQLSTATE XX000 error inside the send guard's single-run transaction.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { pldbgapi2Abort } from '../src/testing/pldbgapi2.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const flags = new CommunityFlagEvaluationService(prisma, {
  getFeatureFlagValue: () => Promise.resolve(true),
})
let server: Server
let endpoint: string
const requests: unknown[] = []
const sender = () =>
  new CommunitySendGuard(prisma, flags, new CommunityPushProvider(fetch, endpoint))

/** The real client, except that the first transaction it runs aborts after its callback. */
function abortingFirstTransaction() {
  let runs = 0
  const client = new Proxy(prisma, {
    get(target, property): unknown {
      if (property !== '$transaction') return Reflect.get(target, property)
      return (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: Parameters<PrismaClient['$transaction']>[1]
      ) =>
        target.$transaction(async (tx) => {
          const result = await work(tx)
          if (runs++ === 0) throw pldbgapi2Abort()
          return result
        }, options)
    },
  })
  return { client, runs: () => runs }
}

async function arm(point: 'guards' | 'receipt') {
  await prisma.$executeRaw`UPDATE pldbgapi2_injection SET point = ${point}`
  await prisma.$executeRawUnsafe('ALTER SEQUENCE pldbgapi2_hits RESTART')
}
async function hits() {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM pldbgapi2_hits`
  return Number(row!.n)
}

beforeAll(async () => {
  await db.migrate()
  await prisma.$executeRawUnsafe('CREATE SEQUENCE pldbgapi2_hits')
  await prisma.$executeRawUnsafe('CREATE TABLE pldbgapi2_injection (point text)')
  await prisma.$executeRawUnsafe('INSERT INTO pldbgapi2_injection VALUES (NULL)')
  // Inside the send guard's transaction only: it alone sets lock_timeout to 250ms.
  await prisma.$executeRawUnsafe(
    'ALTER FUNCTION community_privacy_guards(text[],text[],boolean) RENAME TO community_privacy_guards_unwrapped'
  )
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION community_privacy_guards(members text[], posts text[], exclusive boolean)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('lock_timeout') = '250ms'
        AND (SELECT point FROM pldbgapi2_injection) = 'guards'
        AND nextval('pldbgapi2_hits') = 1 THEN
        RAISE EXCEPTION 'cannot find parent statement on pldbgapi2 call stack' USING ERRCODE = 'XX000';
      END IF;
      PERFORM community_privacy_guards_unwrapped(members, posts, exclusive);
    END $$`)
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION pldbgapi2_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (SELECT point FROM pldbgapi2_injection) = 'receipt'
        AND nextval('pldbgapi2_hits') = 1 THEN
        RAISE EXCEPTION 'cannot find parent statement on pldbgapi2 call stack' USING ERRCODE = 'XX000';
      END IF;
      RETURN NEW;
    END $$`)
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER pldbgapi2_receipt BEFORE INSERT ON "CommunityDeliveryReceipt" FOR EACH ROW EXECUTE FUNCTION pldbgapi2_receipt()'
  )
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({ data: { status: 'ok', id: `ticket-${requests.length}` } })
      )
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`
}, 60_000)
beforeEach(async () => {
  requests.length = 0
  await prisma.$executeRaw`UPDATE pldbgapi2_injection SET point = NULL`
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 0 WHERE id = 1`
  await prisma.communityNotificationIntent.deleteMany()
  await prisma.communityNotificationGroup.deleteMany()
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  await prisma.$disconnect()
  await db.drop()
})

/** One qualified reaction notification for an author with `tokens` registrations. */
async function qualified(tokens: number) {
  const active = { profilePreferences: { compliance: { accountStatus: 'active' } } }
  const author = await persistUser(prisma, createUser(active))
  const actor = await persistUser(prisma, createUser(active))
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: author.id, status: 'published' })
    ),
  })
  await prisma.notificationPreference.create({ data: { user_id: author.id } })
  await prisma.communityNotificationPreference.create({
    data: { user_id: author.id, enabled: true },
  })
  const registrations = new PushRegistrationService(prisma)
  for (let index = 0; index < tokens; index++)
    await registrations.register(author.id, {
      token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
      installationId: randomUUID(),
      platform: 'ios',
      permission: 'granted',
    })
  await new CommunityRepository(prisma).setReaction({
    userId: actor.id,
    postId: post.id,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  return { author, post }
}

/** A pending delivery ready for the guarded send, as the delivery suite builds it. */
async function pendingDelivery() {
  const { author, post } = await qualified(1)
  const worker = new CommunityNotificationsWorker(prisma, sender())
  await worker.group()
  await worker.fanout()
  const [delivery] = await prisma.communityTokenDelivery.findMany({
    where: { group: { post_id: post.id } },
  })
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  return { author, delivery: delivery! }
}

describe('notification counts after a re-run', () => {
  it('group counts one attachment when its first run rolled back', async () => {
    const { post } = await qualified(1)
    const aborting = abortingFirstTransaction()
    const worker = new CommunityNotificationsWorker(aborting.client, sender())
    await expect(worker.group()).resolves.toBe(1)
    expect(aborting.runs()).toBe(2)
    expect(
      await prisma.communityNotificationGroup.count({ where: { post_id: post.id } })
    ).toBe(1)
  })

  it('fan-out counts each delivery once when its first run rolled back', async () => {
    const { post } = await qualified(2)
    await new CommunityNotificationsWorker(prisma, sender()).group()
    const aborting = abortingFirstTransaction()
    const worker = new CommunityNotificationsWorker(aborting.client, sender())
    await expect(worker.fanout()).resolves.toBe(2)
    expect(aborting.runs()).toBe(2)
    expect(
      await prisma.communityTokenDelivery.count({
        where: { group: { post_id: post.id } },
      })
    ).toBe(2)
  })
})

describe('send guard under a pldbgapi2 abort (single run)', () => {
  it('defers without a provider call when the abort hits its privacy guards', async () => {
    const { delivery } = await pendingDelivery()
    await arm('guards')
    await sender().dispatch(delivery.id)
    // One abort and no re-run: a re-run would have passed the guards and sent.
    expect(await hits()).toBe(1)
    expect(requests).toHaveLength(0)
    expect(
      await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: delivery.id },
      })
    ).toMatchObject([{ status: 'deferred', reason: 'no_call:guard_failure' }])
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'deferred' })
  })

  it('sends once and records the handoff as uncertain when the abort follows the send', async () => {
    const { delivery } = await pendingDelivery()
    await arm('receipt')
    await sender().dispatch(delivery.id)
    expect(await hits()).toBe(1)
    expect(requests).toHaveLength(1)
    expect(
      await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: delivery.id },
      })
    ).toMatchObject([{ status: 'unknown', reason: 'handoff_uncertain' }])
    expect(await prisma.communityDeliveryReceipt.count()).toBe(0)
  })
})
