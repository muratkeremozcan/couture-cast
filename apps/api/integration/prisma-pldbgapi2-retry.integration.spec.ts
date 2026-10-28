// The central pldbgapi2 retry against a real Postgres. A trigger injects the exact
// SQLSTATE XX000 abort plpgsql_check raises; a sequence counts statement attempts
// outside every transaction, so a rolled-back attempt still counts.
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  createPrismaClient,
  interactiveTransaction,
  isPldbgapi2StackError,
} from '../src/prisma/prisma-client.js'

const database = isolatedCommunityDatabase()
const admin = new PrismaClient({ datasources: { db: { url: database.url } } })
const prisma = createPrismaClient({ datasources: { db: { url: database.url } } })
const PROBE = 'pldbgapi2-probe'
let user = ''
let users = 0

async function inject(failures: number) {
  await admin.$executeRaw`UPDATE pldbgapi2_injection SET failures = ${failures}`
  await admin.$executeRawUnsafe('ALTER SEQUENCE pldbgapi2_attempts RESTART')
  // AuditLog rows are immutable, so each test counts the rows of its own user.
  user = (
    await admin.user.create({ data: { email: `pldbgapi2-${++users}@example.test` } })
  ).id
}
async function attempts() {
  const [row] = await admin.$queryRaw<{ n: bigint }[]>`
    SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM pldbgapi2_attempts`
  return Number(row!.n)
}
const rows = (event_type: string) =>
  admin.auditLog.count({ where: { user_id: user, event_type } })
const probe = (client: Pick<Prisma.TransactionClient, 'auditLog'>) =>
  client.auditLog.create({ data: { user_id: user, event_type: PROBE } })
// Counts how many times the helper starts a fresh transaction.
function counted() {
  const client = {
    starts: 0,
    $transaction: ((...args: Parameters<PrismaClient['$transaction']>) => {
      client.starts++
      return prisma.$transaction(...args)
    }) as PrismaClient['$transaction'],
  }
  return client
}

beforeAll(async () => {
  await database.migrate()
  await admin.$executeRawUnsafe('CREATE SEQUENCE pldbgapi2_attempts')
  await admin.$executeRawUnsafe(
    'CREATE TABLE pldbgapi2_injection (failures integer NOT NULL)'
  )
  await admin.$executeRawUnsafe('INSERT INTO pldbgapi2_injection VALUES (0)')
  await admin.$executeRawUnsafe(`
    CREATE FUNCTION pldbgapi2_inject() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = '${PROBE}'
        AND nextval('pldbgapi2_attempts') <= (SELECT failures FROM pldbgapi2_injection) THEN
        RAISE EXCEPTION 'cannot find parent statement on pldbgapi2 call stack'
          USING ERRCODE = 'XX000';
      END IF;
      RETURN NEW;
    END $$`)
  await admin.$executeRawUnsafe(
    'CREATE TRIGGER pldbgapi2_inject BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION pldbgapi2_inject()'
  )
}, 60_000)
afterAll(async () => {
  await prisma.$disconnect()
  await admin.$disconnect()
  await database.drop()
})
beforeEach(() => inject(0))

describe('top-level operations', () => {
  it('retries a model write until it commits', async () => {
    await inject(2)
    await probe(prisma)
    expect(await attempts()).toBe(3)
    expect(await rows(PROBE)).toBe(1)
  })
  it('retries a raw statement until it commits', async () => {
    await inject(1)
    await prisma.$executeRaw`
      INSERT INTO "AuditLog" (id, user_id, event_type) VALUES ('raw-probe', ${user}, ${PROBE})`
    expect(await attempts()).toBe(2)
    expect(await rows(PROBE)).toBe(1)
  })
  it('surfaces the abort after three attempts', async () => {
    await inject(5)
    const error = await probe(prisma).catch((caught: unknown) => caught)
    expect(isPldbgapi2StackError(error)).toBe(true)
    expect(await attempts()).toBe(3)
    expect(await rows(PROBE)).toBe(0)
  })
  it('leaves a plain client without the retry', async () => {
    await inject(1)
    await expect(probe(admin)).rejects.toSatisfy(isPldbgapi2StackError)
    expect(await attempts()).toBe(1)
  })
})

describe('inside transactions the extension stays inactive', () => {
  it('passes an interactive transaction statement through once', async () => {
    await inject(1)
    const error = await prisma
      .$transaction(async (tx) => probe(tx))
      .catch((caught: unknown) => caught)
    expect(isPldbgapi2StackError(error)).toBe(true)
    expect(await attempts()).toBe(1)
  })
  it('passes a batch transaction statement through once', async () => {
    await inject(1)
    const error = await prisma
      .$transaction([probe(prisma)])
      .catch((caught: unknown) => caught)
    expect(isPldbgapi2StackError(error)).toBe(true)
    expect(await attempts()).toBe(1)
  })
})

describe('interactiveTransaction', () => {
  it('re-runs the whole rolled-back transaction, one statement attempt per run', async () => {
    await inject(2)
    const client = counted()
    await interactiveTransaction(client, async (tx) => {
      await tx.auditLog.create({ data: { user_id: user, event_type: 'companion' } })
      await probe(tx)
    })
    expect(client.starts).toBe(3)
    expect(await attempts()).toBe(3)
    // The companion write of each aborted run rolled back with it.
    expect(await rows('companion')).toBe(1)
    expect(await rows(PROBE)).toBe(1)
  })
  it('surfaces the abort after three transactions and commits nothing', async () => {
    await inject(5)
    const client = counted()
    const error = await interactiveTransaction(client, async (tx) => {
      await tx.auditLog.create({ data: { user_id: user, event_type: 'companion' } })
      await probe(tx)
    }).catch((caught: unknown) => caught)
    expect(isPldbgapi2StackError(error)).toBe(true)
    expect(client.starts).toBe(3)
    expect(await attempts()).toBe(3)
    expect(await rows('companion')).toBe(0)
  })
})
