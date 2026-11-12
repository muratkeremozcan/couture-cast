// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
//
// community_append_batch, driven at the database the way the worker calls it. Each case wraps the
// deployed community_append_prepare in this isolated database only, to stop or slow it at a
// chosen point, and restores it afterwards (Codex review of #208, its reproductions committed).
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

const database = isolatedCommunityDatabase()
let appender: Client
let other: Client
type Batch = { count: number; stop: string; ready: number; preparedMs: number }

/** Replaces the candidate function with `body` (plpgsql), which may call the real one. */
async function wrapPrepare(body: string) {
  await appender.query(
    'ALTER FUNCTION community_append_prepare(uuid,jsonb) RENAME TO test_actual_prepare'
  )
  await appender.query(`CREATE FUNCTION community_append_prepare(candidate_id uuid, seen jsonb)
    RETURNS "CommunityDomainOutbox" LANGUAGE plpgsql AS $$ BEGIN ${body}
      RETURN test_actual_prepare(candidate_id, seen); END $$`)
}
async function restorePrepare() {
  const wrapped = await appender.query(
    "SELECT 1 FROM pg_proc WHERE proname = 'test_actual_prepare'"
  )
  if (!wrapped.rowCount) return
  await appender.query('DROP FUNCTION community_append_prepare(uuid,jsonb)')
  await appender.query(
    'ALTER FUNCTION test_actual_prepare(uuid,jsonb) RENAME TO community_append_prepare'
  )
}
const batch = async () =>
  (
    await appender.query<{ batch: Batch }>(
      'SELECT community_append_batch(25, 4) AS batch'
    )
  ).rows[0]!.batch
async function resyncRows(count: number) {
  await appender.query(
    `INSERT INTO "CommunityDomainOutbox" (id, stream_id, kind, revision)
     SELECT gen_random_uuid(), 'public', 'resync', 1 FROM generate_series(1, $1::int)`,
    [count]
  )
}

beforeAll(async () => {
  await database.migrate()
  appender = new Client({ connectionString: database.url })
  other = new Client({ connectionString: database.url })
  await Promise.all([appender.connect(), other.connect()])
}, 30_000)
afterEach(async () => {
  await appender.query('RESET statement_timeout')
  await restorePrepare()
  await appender.query('DELETE FROM "CommunityStreamEvent"')
  await appender.query('DELETE FROM "CommunityArtifactSubject"')
  await appender.query('DELETE FROM "CommunityDomainOutbox"')
})
afterAll(async () => {
  await Promise.all([appender?.end(), other?.end()])
  await database.drop()
})

describe('community_append_batch inside the database', () => {
  it('skips a candidate whose subject generation changes between the batch read and preparation, then appends it', async () => {
    await resyncRows(1)
    const { id } = (
      await appender.query<{ id: string }>('SELECT id FROM "CommunityDomainOutbox"')
    ).rows[0]!
    const member = randomUUID()
    await appender.query(
      'INSERT INTO "User" (id, email, updated_at) VALUES ($1, $2, clock_timestamp())',
      [member, `append-barrier-${member}@synthetic.test`]
    )
    await appender.query(
      `INSERT INTO "CommunityArtifactSubject" (artifact_kind, artifact_id, member_id, role, generation)
       VALUES ('outbox', $1, $2, 'author', 1)`,
      [id, member]
    )
    // The batch reads the subjects, then the wrapper waits on a barrier before the real
    // preparation runs; the other session changes the generation in that gap.
    await wrapPrepare(
      'PERFORM pg_advisory_lock(999001); PERFORM pg_advisory_unlock(999001);'
    )
    await other.query('SELECT pg_advisory_lock(999001)')
    const pid = (await appender.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!.pid
    const inflight = batch()
    // Settled whatever happens below, so a failure never leaves the batch blocked on the
    // barrier with afterEach queued behind it on the same client.
    const outcome = inflight.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    try {
      let waiting = false
      for (let attempt = 0; attempt < 400 && !waiting; attempt++) {
        const row = (
          await other.query<{ wait_event: string | null }>(
            'SELECT wait_event FROM pg_stat_activity WHERE pid = $1',
            [pid]
          )
        ).rows[0]
        waiting = row?.wait_event === 'advisory'
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(waiting, 'the batch reached the barrier').toBe(true)
      await other.query(
        'UPDATE "CommunityArtifactSubject" SET generation = generation + 1 WHERE artifact_id = $1',
        [id]
      )
    } finally {
      await other.query('SELECT pg_advisory_unlock(999001)')
      await outcome
    }
    expect(await inflight).toMatchObject({ count: 0, ready: 0 })
    expect(
      (
        await appender.query(
          'SELECT 1 FROM "CommunityDomainOutbox" WHERE appended_at IS NULL'
        )
      ).rowCount
    ).toBe(1)
    // Unblocked, the next batch reads the new links; the member has no CommunitySubject row, so
    // the public row appends as an identifier-free resync.
    await restorePrepare()
    expect(await batch()).toMatchObject({ count: 1 })
    expect(
      (await appender.query<{ kind: string }>('SELECT kind FROM "CommunityStreamEvent"'))
        .rows
    ).toEqual([{ kind: 'resync' }])
  })

  it('closes the preparation window once real server preparation passes 150 ms', async () => {
    await resyncRows(10)
    // 40 ms per candidate: the window is spent after four.
    await wrapPrepare('PERFORM pg_sleep(0.04);')
    const result = await batch()
    expect(result.stop).toBe('window')
    expect(result.ready).toBeLessThanOrEqual(4)
    expect(result.ready).toBeGreaterThanOrEqual(1)
    expect(result.preparedMs).toBeGreaterThanOrEqual(150)
    expect(result.count).toBe(result.ready)
    expect(
      (
        await appender.query(
          'SELECT 1 FROM "CommunityDomainOutbox" WHERE appended_at IS NULL'
        )
      ).rowCount
    ).toBe(10 - result.count)
  })

  it('is bounded by the caller statement timeout, even inside candidate preparation', async () => {
    await resyncRows(1)
    await wrapPrepare('PERFORM pg_sleep(1);')
    await appender.query("SET statement_timeout = '100ms'")
    const started = performance.now()
    await expect(batch()).rejects.toMatchObject({ code: '57014' })
    expect(performance.now() - started).toBeLessThan(900)
  })
})
