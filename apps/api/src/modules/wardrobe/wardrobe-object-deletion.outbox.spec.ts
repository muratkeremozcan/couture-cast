// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (review round 2, Codex C2-3 and C2-4): every wardrobe-images
// deletion goes through a durable outbox. A failed removal stays recorded and the hourly job
// retries it, and nothing still live (a committed final object, a garment under legal hold) is
// ever removed on the outbox's word.
//
// Round 4 (Codex C3-1, C3-3, C3-4 and C3-11): each key is settled in its own transaction that
// locks the one row the parsed key names, judges the key against that row only, and removes the
// object while the lock is held. A key whose session a commit is still publishing waits for the
// claim's lease. One key's storage fault no longer holds back the others.
import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DELETION_ALERT_ATTEMPTS,
  WardrobeObjectDeletionOutbox,
} from './wardrobe-object-deletion.outbox'
import { PUBLISH_CLAIM_LEASE_MS } from './wardrobe-publication'

const USER = 'user-1'
const OTHER_USER = 'user-2'
const SESSION_A = '3f2e1d0c-9b8a-4776-8554-433221100fed'
const SESSION_B = '4a3b2c1d-0e9f-4887-8665-5443322110fe'
const GARMENT = '5b4c3d2e-1f0a-4998-8776-6554433221a0'
const HISTORICAL_GARMENT = '6c5d4e3f-2a1b-4aa9-9887-7665544332b1'

const GARMENT_FINAL = `wardrobe/${USER}/${GARMENT}.jpg`
const MY_FORM_FINAL = `wardrobe/${USER}/silhouette/${SESSION_A}.jpg`
const SELFIE_FINAL = `wardrobe/${USER}/palette/${SESSION_A}.jpg`
const GARMENT_STAGING = `staging/${USER}/garment/${SESSION_A}.jpg`
const SELFIE_STAGING = `staging/${USER}/palette/${SESSION_B}.jpg`
const UNPARSEABLE = 'somewhere/else.bin'
const GARMENT_HELD = `held/${USER}/${GARMENT}.jpg`

const NOW = new Date('2026-11-19T12:00:00.000Z')
const LATER = new Date('2026-11-19T13:00:00.000Z')
const FIVE_MINUTES_MS = 5 * 60 * 1000

const loggerMocks = vi.hoisted(() => {
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { child }
})

vi.mock('../../logger/pino.config', () => ({
  createBaseLogger: () => ({ child: () => loggerMocks.child }),
}))

type DeletionRow = {
  id: string
  object_path: string
  reason: string
  attempts: number
  not_before: Date
  repeat_until?: Date | null
}

type Row = Record<string, unknown>

function deletionRow(
  objectPath: string,
  overrides: Partial<DeletionRow> = {}
): DeletionRow {
  return {
    id: `deletion-${objectPath}`,
    object_path: objectPath,
    reason: 'garment_purged',
    attempts: 0,
    not_before: NOW,
    ...overrides,
  }
}

function garmentRow(overrides: Row = {}): Row {
  return {
    id: GARMENT,
    user_id: USER,
    object_path: GARMENT_FINAL,
    upload_session_id: SESSION_A,
    upload_status: 'ready',
    retention_status: 'active',
    retention_purged_at: null,
    publish_attempt_id: null,
    publish_started_at: null,
    ...overrides,
  }
}

function myFormRow(overrides: Row = {}): Row {
  return {
    user_id: USER,
    my_form_object_path: MY_FORM_FINAL,
    my_form_upload_session_id: SESSION_A,
    my_form_status: 'ready',
    my_form_publish_attempt_id: null,
    my_form_publish_started_at: null,
    ...overrides,
  }
}

function selfieRow(overrides: Row = {}): Row {
  return {
    user_id: USER,
    selfie_object_path: SELFIE_FINAL,
    selfie_upload_session_id: SESSION_A,
    status: 'processing',
    // A committed selfie's own analysis: its attempt is the selfie session.
    source: 'selfie',
    analysis_attempt_id: SESSION_A,
    selfie_publish_attempt_id: null,
    selfie_publish_started_at: null,
    ...overrides,
  }
}

describe('WardrobeObjectDeletionOutbox', () => {
  /**
   * An in-memory stand-in for the four tables the outbox reads, plus an ordered event log of
   * transaction boundaries, row locks and storage removals. The log is how a test proves the
   * authoritative row was locked before the object was removed, and that the removal ran inside
   * the settling transaction.
   */
  let garments: Row[]
  let myForms: Row[]
  let selfies: Row[]
  let deletions: Map<string, DeletionRow>
  let events: string[]
  let inTransaction: boolean
  /** Runs when a row lock is taken, to model a write that committed while the lock waited. */
  let onLock: (table: string) => void

  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const table = /FROM "(\w+)"/.exec(strings.join('?'))?.[1] ?? 'unknown'
    events.push(`lock ${table} ${values.join(',')}`)
    onLock(table)
    return Promise.resolve([])
  })
  const garmentFindFirst = vi.fn(({ where }: { where: Row }) =>
    Promise.resolve(
      garments.find((row) =>
        Object.entries(where).every(([column, value]) => row[column] === value)
      ) ?? null
    )
  )
  const myFormFindUnique = vi.fn(({ where }: { where: { user_id: string } }) =>
    Promise.resolve(myForms.find((row) => row.user_id === where.user_id) ?? null)
  )
  const selfieFindUnique = vi.fn(({ where }: { where: { user_id: string } }) =>
    Promise.resolve(selfies.find((row) => row.user_id === where.user_id) ?? null)
  )
  const deletionFindUnique = vi.fn(({ where }: { where: { object_path: string } }) =>
    Promise.resolve(deletions.get(where.object_path) ?? null)
  )
  const deletionUpdate = vi.fn(
    ({ where, data }: { where: { id: string }; data: Partial<DeletionRow> }) => {
      for (const row of deletions.values()) {
        if (row.id === where.id) Object.assign(row, data)
      }
      return Promise.resolve({})
    }
  )
  const deletionDelete = vi.fn(({ where }: { where: { id: string } }) => {
    for (const [path, row] of deletions) {
      if (row.id === where.id) deletions.delete(path)
    }
    events.push(`delete-row ${where.id}`)
    return Promise.resolve({})
  })

  const tx = {
    $queryRaw: queryRaw,
    garmentItem: { findFirst: garmentFindFirst },
    silhouetteProfile: { findUnique: myFormFindUnique },
    paletteProfile: { findUnique: selfieFindUnique },
    wardrobeObjectDeletion: {
      findUnique: deletionFindUnique,
      update: deletionUpdate,
      delete: deletionDelete,
    },
  }

  const createMany = vi.fn()
  const updateMany = vi.fn()
  const findMany = vi.fn()
  const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
    events.push('begin')
    inTransaction = true
    try {
      return await work(tx)
    } finally {
      inTransaction = false
      events.push('end')
    }
  })
  const prisma = {
    $transaction: transaction,
    wardrobeObjectDeletion: { createMany, updateMany, findMany },
  } as unknown as PrismaClient

  const remove = vi.fn((paths: string[]) => {
    events.push(`remove ${paths.join(',')} in-transaction=${inTransaction}`)
    return Promise.resolve()
  })
  const outbox = new WardrobeObjectDeletionOutbox(prisma, { remove })

  /** Records `paths` as due rows. */
  function due(...rows: DeletionRow[]) {
    for (const row of rows) deletions.set(row.object_path, row)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    garments = []
    myForms = []
    selfies = []
    deletions = new Map()
    events = []
    inTransaction = false
    onLock = () => undefined
    createMany.mockResolvedValue({ count: 1 })
    updateMany.mockResolvedValue({ count: 1 })
    findMany.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('record', () => {
    it('writes one row per distinct path and leaves an already recorded path alone', async () => {
      await outbox.record(
        prisma,
        [SELFIE_FINAL, SELFIE_STAGING, SELFIE_FINAL],
        'selfie_erased'
      )

      expect(createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          { object_path: SELFIE_FINAL, reason: 'selfie_erased' },
          { object_path: SELFIE_STAGING, reason: 'selfie_erased' },
        ],
        skipDuplicates: true,
      })
      expect(updateMany).not.toHaveBeenCalled()
    })

    it('writes nothing for no paths', async () => {
      await outbox.record(prisma, [], 'selfie_erased')

      expect(createMany).not.toHaveBeenCalled()
    })

    // Round 4 (Codex C3-1): erasure that meets an unfinished publication defers its keys.
    it('records with a later start and pushes an already recorded path back to it', async () => {
      await outbox.record(prisma, [SELFIE_FINAL, SELFIE_STAGING], 'selfie_erased', LATER)

      expect(createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          { object_path: SELFIE_FINAL, reason: 'selfie_erased', not_before: LATER },
          { object_path: SELFIE_STAGING, reason: 'selfie_erased', not_before: LATER },
        ],
        skipDuplicates: true,
      })
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          object_path: { in: [SELFIE_FINAL, SELFIE_STAGING] },
          not_before: { lt: LATER },
        },
        data: { not_before: LATER },
      })
    })
  })

  describe('removeNow', () => {
    // Round 4 (Codex C3-3): the row lock is held across the storage removal.
    it('locks the key row, then its outbox row, removes the object inside that transaction and deletes the row', async () => {
      due(deletionRow(MY_FORM_FINAL))

      await outbox.removeNow([MY_FORM_FINAL])

      expect(events).toEqual([
        'begin',
        `lock SilhouetteProfile ${USER}`,
        `lock WardrobeObjectDeletion ${MY_FORM_FINAL}`,
        `remove ${MY_FORM_FINAL} in-transaction=true`,
        `delete-row deletion-${MY_FORM_FINAL}`,
        'end',
      ])
      expect(deletions.size).toBe(0)
    })

    it('settles each path in its own transaction', async () => {
      due(deletionRow(MY_FORM_FINAL), deletionRow(SELFIE_STAGING))

      await outbox.removeNow([MY_FORM_FINAL, SELFIE_STAGING, MY_FORM_FINAL])

      expect(transaction).toHaveBeenCalledTimes(2)
      expect(remove.mock.calls).toEqual([[[MY_FORM_FINAL]], [[SELFIE_STAGING]]])
    })

    it('leaves a row recorded for later alone', async () => {
      due(deletionRow(SELFIE_FINAL, { not_before: LATER }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).not.toHaveBeenCalled()
      expect(deletions.get(SELFIE_FINAL)?.not_before).toEqual(LATER)
    })

    it('removes nothing for a path that has no outbox row', async () => {
      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).not.toHaveBeenCalled()
    })

    it('keeps the row and defers it when storage fails, without throwing', async () => {
      due(deletionRow(SELFIE_STAGING))
      remove.mockRejectedValueOnce(new TypeError('fetch failed'))

      await expect(outbox.removeNow([SELFIE_STAGING])).resolves.toBeUndefined()

      expect(deletions.has(SELFIE_STAGING)).toBe(true)
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { object_path: SELFIE_STAGING },
        data: {
          attempts: { increment: 1 },
          last_error: 'TypeError',
          not_before: new Date(NOW.getTime() + FIVE_MINUTES_MS),
        },
      })
    })

    it('records and removes in one call, and swallows a failed record', async () => {
      createMany.mockRejectedValueOnce(new Error('db down'))

      await expect(
        outbox.recordAndRemove([SELFIE_FINAL], 'selfie_purged')
      ).resolves.toBeUndefined()

      expect(transaction).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(loggerMocks.child.error).toHaveBeenCalledWith(
        { reason: 'selfie_purged', count: 1, errorClass: 'Error' },
        'wardrobe_object_deletion_record_failed'
      )
    })
  })

  describe('judging a key against its authoritative row', () => {
    // Round 4 (Codex C3-4): liveness no longer matches path text across tables.
    it('removes an erased selfie that a historical garment row names as its path, and keeps a live My Form beside it', async () => {
      garments = [
        garmentRow({
          id: HISTORICAL_GARMENT,
          object_path: SELFIE_FINAL,
          upload_status: 'ready',
        }),
      ]
      selfies = [
        selfieRow({
          selfie_upload_session_id: null,
          selfie_object_path: null,
          status: null,
        }),
      ]
      myForms = [myFormRow({ my_form_status: 'ready' })]
      due(deletionRow(SELFIE_FINAL), deletionRow(MY_FORM_FINAL))

      await outbox.removeNow([SELFIE_FINAL, MY_FORM_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
      expect(garmentFindFirst).not.toHaveBeenCalled()
      expect(deletions.size).toBe(0)
      expect(loggerMocks.child.warn).toHaveBeenCalledWith(
        { reason: 'garment_purged' },
        'wardrobe_object_deletion_skipped_live'
      )
    })

    it('reads a final garment key by the garment id and owner, a staging key by the session and owner', async () => {
      due(deletionRow(GARMENT_FINAL), deletionRow(GARMENT_STAGING))

      await outbox.removeNow([GARMENT_FINAL, GARMENT_STAGING])

      expect(queryRaw.mock.calls.map((call) => call.slice(1))).toEqual([
        [GARMENT, USER],
        [GARMENT_FINAL],
        [SESSION_A, USER],
        [GARMENT_STAGING],
      ])
      expect(garmentFindFirst.mock.calls).toEqual([
        [{ where: { id: GARMENT, user_id: USER } }],
        [{ where: { upload_session_id: SESSION_A, user_id: USER } }],
      ])
    })

    it('keeps a committed garment object and removes one the row no longer names', async () => {
      garments = [garmentRow({ upload_status: 'awaiting_tags' })]
      due(deletionRow(GARMENT_FINAL))

      await outbox.removeNow([GARMENT_FINAL])
      expect(remove).not.toHaveBeenCalled()

      garments = [
        garmentRow({
          object_path: null,
          upload_status: 'failed',
          retention_purged_at: NOW,
        }),
      ]
      due(deletionRow(GARMENT_FINAL))

      await outbox.removeNow([GARMENT_FINAL])
      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_FINAL])
    })

    it('never treats another member as the owner of a key', async () => {
      garments = [garmentRow({ user_id: OTHER_USER, upload_status: 'ready' })]
      due(deletionRow(GARMENT_FINAL))

      await outbox.removeNow([GARMENT_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_FINAL])
    })

    // Round 4 (Codex C3-3): a hold applied by an operator while the lock waited is seen.
    it('keeps a staged object whose garment came under legal hold while the lock waited', async () => {
      garments = [
        garmentRow({ upload_status: 'pending_upload', object_path: GARMENT_FINAL }),
      ]
      onLock = (table) => {
        if (table === 'GarmentItem') garments[0]!.retention_status = 'legal_hold'
      }
      due(deletionRow(GARMENT_STAGING, { reason: 'staging_swept' }))

      await outbox.removeNow([GARMENT_STAGING])

      expect(remove).not.toHaveBeenCalled()
      expect(deletions.size).toBe(0)
    })

    it('keeps a legacy relay My Form upload awaiting commit and a processing selfie', async () => {
      myForms = [myFormRow({ my_form_status: 'bytes_uploaded' })]
      selfies = [selfieRow({ status: 'processing' })]
      due(deletionRow(MY_FORM_FINAL), deletionRow(SELFIE_FINAL))

      await outbox.removeNow([MY_FORM_FINAL, SELFIE_FINAL])

      expect(remove).not.toHaveBeenCalled()
    })

    /**
     * Final review F-6, legacy rows (Codex review 21): an analysis an older API instance started
     * has no attempt id. Its source alone decides: a selfie analysis keeps the selfie's final key,
     * while a wardrobe analysis lets a repeating purge remove it and keep repeating.
     */
    it('keeps the final key of a legacy selfie analysis with no attempt id', async () => {
      selfies = [
        selfieRow({ status: 'processing', source: 'selfie', analysis_attempt_id: null }),
      ]
      const horizon = new Date(NOW.getTime() + 60 * 60 * 1000)
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged', repeat_until: horizon }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).not.toHaveBeenCalled()
      // The selfie's own analysis owns the key now; its terminal purge records a fresh obligation.
      expect(deletions.has(SELFIE_FINAL)).toBe(false)
    })

    it('removes the selfie key under a legacy wardrobe analysis and keeps repeating the purge', async () => {
      selfies = [
        selfieRow({
          status: 'processing',
          source: 'wardrobe',
          analysis_attempt_id: null,
        }),
      ]
      const horizon = new Date(NOW.getTime() + 60 * 60 * 1000)
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged', repeat_until: horizon }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
      expect(deletions.get(SELFIE_FINAL)).toMatchObject({ repeat_until: horizon })
    })

    /**
     * Final review F-6: a wardrobe analysis started on a profile whose selfie analysis finished
     * leaves the row processing with the old selfie columns. A repeating purge of that selfie
     * must keep removing it: only the selfie's own analysis (source selfie, attempt equal to
     * its session) keeps the selfie.
     */
    it.each([
      [
        'a wardrobe analysis',
        { source: 'wardrobe', analysis_attempt_id: 'wardrobe-attempt' },
      ],
      ['another attempt', { source: 'selfie', analysis_attempt_id: 'other-session' }],
    ])(
      'keeps repeating a selfie purge while %s processes the profile',
      async (_, analysis) => {
        selfies = [selfieRow({ status: 'processing', ...analysis })]
        const horizon = new Date(NOW.getTime() + 60 * 60 * 1000)
        due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged', repeat_until: horizon }))

        await outbox.removeNow([SELFIE_FINAL])

        expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
        expect(deletions.get(SELFIE_FINAL)).toMatchObject({ repeat_until: horizon })
      }
    )

    it('removes a selfie whose analysis ended, since selfies are purged by design', async () => {
      selfies = [selfieRow({ status: 'ready' })]
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged' }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
    })

    it('removes a key no builder could have made without reading any row but its own', async () => {
      due(deletionRow(UNPARSEABLE))

      await outbox.removeNow([UNPARSEABLE])

      expect(queryRaw.mock.calls.map((call) => call.slice(1))).toEqual([[UNPARSEABLE]])
      expect(remove).toHaveBeenCalledExactlyOnceWith([UNPARSEABLE])
    })

    // Round 4 (Codex C3-1): a publish that lands late is removed after it lands.
    it('defers a key whose session a commit is still publishing to the end of that claim', async () => {
      const startedAt = new Date(NOW.getTime() - 60 * 1000)
      selfies = [
        selfieRow({
          status: 'pending_upload',
          selfie_publish_attempt_id: 'attempt-1',
          selfie_publish_started_at: startedAt,
        }),
      ]
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_erased' }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).not.toHaveBeenCalled()
      expect(deletionUpdate).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion-${SELFIE_FINAL}` },
        data: { not_before: new Date(startedAt.getTime() + PUBLISH_CLAIM_LEASE_MS) },
      })
      expect(deletions.has(SELFIE_FINAL)).toBe(true)
    })

    it('defers a garment staging key while its publication is in flight', async () => {
      const startedAt = new Date(NOW.getTime() - 1000)
      garments = [
        garmentRow({
          upload_status: 'pending_upload',
          publish_attempt_id: 'attempt-1',
          publish_started_at: startedAt,
        }),
      ]
      due(deletionRow(GARMENT_STAGING))

      await outbox.removeNow([GARMENT_STAGING])

      expect(remove).not.toHaveBeenCalled()
      expect(deletions.get(GARMENT_STAGING)?.not_before).toEqual(
        new Date(startedAt.getTime() + PUBLISH_CLAIM_LEASE_MS)
      )
    })

    it('removes a key whose publication claim is past its lease', async () => {
      myForms = [
        myFormRow({
          my_form_status: 'pending_upload',
          my_form_publish_attempt_id: 'attempt-1',
          my_form_publish_started_at: new Date(
            NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 1
          ),
        }),
      ]
      due(deletionRow(MY_FORM_FINAL))

      await outbox.removeNow([MY_FORM_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([MY_FORM_FINAL])
    })
  })

  /**
   * Round 5 (Codex C4-2 and C4-6): a rejected garment keeps its session id, so its staging key
   * still finds the garment and a legal hold keeps it; the server's held/ copy of a held
   * garment's source stays exactly while the hold lasts.
   */
  describe('held sources', () => {
    it('keeps the staging key of a rejected garment that came under legal hold', async () => {
      garments = [
        garmentRow({
          upload_status: 'pending_upload',
          upload_ended_at: NOW,
          retention_status: 'legal_hold',
        }),
      ]
      due(deletionRow(GARMENT_STAGING, { reason: 'upload_rejected' }))

      await outbox.removeNow([GARMENT_STAGING])

      expect(events).toContain(`lock GarmentItem ${SESSION_A},${USER}`)
      expect(remove).not.toHaveBeenCalled()
    })

    it('keeps a held copy while its garment is under legal hold, locking the garment by id', async () => {
      garments = [
        garmentRow({ upload_status: 'pending_upload', retention_status: 'legal_hold' }),
      ]
      due(deletionRow(GARMENT_HELD))

      await outbox.removeNow([GARMENT_HELD])

      expect(events).toEqual([
        'begin',
        `lock GarmentItem ${GARMENT},${USER}`,
        `lock WardrobeObjectDeletion ${GARMENT_HELD}`,
        `delete-row deletion-${GARMENT_HELD}`,
        'end',
      ])
      expect(remove).not.toHaveBeenCalled()
    })

    it('removes a held copy once its garment is no longer held', async () => {
      garments = [
        garmentRow({ upload_status: 'failed', retention_status: 'deletion_pending' }),
      ]
      due(deletionRow(GARMENT_HELD))

      await outbox.removeNow([GARMENT_HELD])

      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_HELD])
    })

    it('never lets another member keep a held copy', async () => {
      garments = [garmentRow({ user_id: OTHER_USER, retention_status: 'legal_hold' })]
      due(deletionRow(GARMENT_HELD))

      await outbox.removeNow([GARMENT_HELD])

      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_HELD])
    })
  })

  /**
   * Round 5 (Codex C4-5): where erasure, deletion, purge or replacement meets a publication in
   * flight, the keys are removed at once and again every 15 minutes until 24 hours after the
   * lease started; the lease bounds ownership, not when storage finishes a received write.
   */
  describe('repeating removals', () => {
    const HORIZON = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

    it('records rows due now that repeat until the horizon, and extends an existing row', async () => {
      await outbox.recordRepeating(
        prisma,
        [SELFIE_FINAL, SELFIE_STAGING],
        'selfie_erased',
        HORIZON
      )

      expect(createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            object_path: SELFIE_FINAL,
            reason: 'selfie_erased',
            not_before: NOW,
            repeat_until: HORIZON,
          },
          {
            object_path: SELFIE_STAGING,
            reason: 'selfie_erased',
            not_before: NOW,
            repeat_until: HORIZON,
          },
        ],
        skipDuplicates: true,
      })
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          object_path: { in: [SELFIE_FINAL, SELFIE_STAGING] },
          OR: [{ repeat_until: null }, { repeat_until: { lt: HORIZON } }],
        },
        data: { repeat_until: HORIZON, not_before: NOW },
      })
    })

    it('removes a key a commit is still publishing at once and keeps the row due again in 15 minutes', async () => {
      selfies = [
        selfieRow({
          status: 'pending_upload',
          selfie_publish_attempt_id: 'attempt-1',
          selfie_publish_started_at: new Date(NOW.getTime() - 60 * 1000),
        }),
      ]
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_erased', repeat_until: HORIZON }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(deletions.get(SELFIE_FINAL)).toMatchObject({
        not_before: new Date(NOW.getTime() + FIFTEEN_MINUTES_MS),
        attempts: 0,
      })
    })

    it('runs a repeating removal at once when a caller asks, even before its next repeat is due', async () => {
      // A commit that compensates its late publish must not wait 15 minutes for the next repeat.
      due(
        deletionRow(SELFIE_FINAL, {
          reason: 'selfie_superseded',
          not_before: new Date(NOW.getTime() + FIFTEEN_MINUTES_MS),
          repeat_until: HORIZON,
        })
      )

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
      expect(deletions.has(SELFIE_FINAL)).toBe(true)
    })

    it('leaves a repeating row that is not due alone in the hourly drain', async () => {
      due(
        deletionRow(SELFIE_FINAL, {
          not_before: new Date(NOW.getTime() + FIFTEEN_MINUTES_MS),
          repeat_until: HORIZON,
        })
      )
      findMany.mockResolvedValueOnce([...deletions.values()])

      expect(await outbox.drainDue(NOW)).toBe(0)
      expect(remove).not.toHaveBeenCalled()
    })

    it('removes a late write on every repeat and settles the row on the first removal past the horizon', async () => {
      due(
        deletionRow(MY_FORM_FINAL, { reason: 'my_form_deleted', repeat_until: HORIZON })
      )
      const beforeHorizon = new Date(HORIZON.getTime() - 1)
      findMany.mockResolvedValueOnce([...deletions.values()])

      expect(await outbox.drainDue(beforeHorizon)).toBe(1)
      expect(deletions.has(MY_FORM_FINAL)).toBe(true)

      const pastHorizon = new Date(HORIZON.getTime() + FIFTEEN_MINUTES_MS)
      findMany.mockResolvedValueOnce([...deletions.values()])
      expect(await outbox.drainDue(pastHorizon)).toBe(1)

      expect(remove.mock.calls).toEqual([[[MY_FORM_FINAL]], [[MY_FORM_FINAL]]])
      expect(deletions.size).toBe(0)
    })
  })

  /**
   * Round 6 (Codex C5-2): a final key's session records a cleanup horizon with every claim, kept
   * across the lease, a takeover and success. A one-time removal of that key (the selfie
   * analysis purge, a commit compensation, a sweep) turns into a repeating one until the
   * horizon, whichever caller recorded it. A staging key never does: only the member's signed
   * PUT writes it, and the staging sweep covers that.
   */
  describe('recorded cleanup horizons', () => {
    const recorded = new Date(NOW.getTime() + 20 * 60 * 60 * 1000)

    it('repeats a one-time removal of a purged selfie until the horizon its claims recorded', async () => {
      selfies = [selfieRow({ status: 'ready', selfie_publish_cleanup_until: recorded })]
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged' }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_FINAL])
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(deletions.get(SELFIE_FINAL)).toMatchObject({
        repeat_until: recorded,
        not_before: new Date(NOW.getTime() + 15 * 60 * 1000),
      })
    })

    it('repeats the removal of a purged garment final key the row no longer names', async () => {
      garments = [
        garmentRow({
          object_path: null,
          upload_status: 'failed',
          retention_status: 'deletion_pending',
          retention_purged_at: NOW,
          publish_cleanup_until: recorded,
        }),
      ]
      due(deletionRow(GARMENT_FINAL))

      await outbox.removeNow([GARMENT_FINAL])

      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_FINAL])
      expect(deletions.get(GARMENT_FINAL)?.repeat_until).toEqual(recorded)
    })

    it('keeps the later horizon when the row already repeats until an earlier one', async () => {
      selfies = [selfieRow({ status: 'failed', selfie_publish_cleanup_until: recorded })]
      const earlier = new Date(NOW.getTime() + 60 * 60 * 1000)
      due(deletionRow(SELFIE_FINAL, { repeat_until: earlier }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(deletions.get(SELFIE_FINAL)?.repeat_until).toEqual(recorded)
    })

    it('settles a staging key at once whatever horizon its session recorded', async () => {
      garments = [
        garmentRow({ upload_status: 'processing', publish_cleanup_until: recorded }),
      ]
      due(deletionRow(GARMENT_STAGING, { reason: 'commit_staging_released' }))

      await outbox.removeNow([GARMENT_STAGING])

      expect(remove).toHaveBeenCalledExactlyOnceWith([GARMENT_STAGING])
      expect(deletions.has(GARMENT_STAGING)).toBe(false)
    })

    it('settles a final key once its recorded horizon has passed', async () => {
      selfies = [
        selfieRow({
          status: 'ready',
          selfie_publish_cleanup_until: new Date(NOW.getTime() - 1),
        }),
      ]
      due(deletionRow(SELFIE_FINAL, { reason: 'selfie_purged' }))

      await outbox.removeNow([SELFIE_FINAL])

      expect(deletions.has(SELFIE_FINAL)).toBe(false)
    })
  })

  describe('drainDue', () => {
    it('settles the due rows oldest first and counts them', async () => {
      const rows = [deletionRow(GARMENT_FINAL), deletionRow(SELFIE_STAGING)]
      due(...rows)
      findMany.mockResolvedValueOnce(rows)

      await expect(outbox.drainDue(NOW)).resolves.toBe(2)

      expect(findMany).toHaveBeenCalledExactlyOnceWith({
        where: { not_before: { lte: NOW } },
        orderBy: { not_before: 'asc' },
        take: 100,
      })
      expect(remove.mock.calls).toEqual([[[GARMENT_FINAL]], [[SELFIE_STAGING]]])
      expect(deletions.size).toBe(0)
    })

    // Coordinator follow-up 3 (round 4): a suite draining a shared database settles only the
    // rows it created.
    it('limits the due query to the given keys when the drain is scoped', async () => {
      const rows = [deletionRow(GARMENT_FINAL)]
      due(...rows)
      findMany.mockResolvedValueOnce(rows)

      await expect(outbox.drainDue(NOW, { objectPaths: [GARMENT_FINAL] })).resolves.toBe(
        1
      )

      expect(findMany).toHaveBeenCalledExactlyOnceWith({
        where: { not_before: { lte: NOW }, object_path: { in: [GARMENT_FINAL] } },
        orderBy: { not_before: 'asc' },
        take: 100,
      })
      expect(remove.mock.calls).toEqual([[[GARMENT_FINAL]]])
    })

    it('counts a live key it drops but not one it defers', async () => {
      myForms = [myFormRow({ my_form_status: 'ready' })]
      selfies = [
        selfieRow({
          selfie_upload_session_id: SESSION_B,
          status: 'pending_upload',
          selfie_publish_attempt_id: 'attempt-1',
          selfie_publish_started_at: NOW,
        }),
      ]
      const rows = [deletionRow(MY_FORM_FINAL), deletionRow(SELFIE_STAGING)]
      due(...rows)
      findMany.mockResolvedValueOnce(rows)

      await expect(outbox.drainDue(NOW)).resolves.toBe(1)

      expect(remove).not.toHaveBeenCalled()
      expect([...deletions.keys()]).toEqual([SELFIE_STAGING])
    })

    it('does nothing when no row is due', async () => {
      await expect(outbox.drainDue(NOW)).resolves.toBe(0)

      expect(transaction).not.toHaveBeenCalled()
    })

    // Round 4 (Codex C3-11): one key's fault no longer blocks the rest of the batch.
    it('backs a failed row off exponentially, logs an error once it is stuck, and still settles the others', async () => {
      const rows = [
        deletionRow(GARMENT_FINAL, { attempts: 0 }),
        deletionRow(SELFIE_STAGING, { attempts: DELETION_ALERT_ATTEMPTS - 1 }),
        deletionRow(MY_FORM_FINAL),
      ]
      due(...rows)
      findMany.mockResolvedValueOnce(rows)
      remove
        .mockRejectedValueOnce(new Error('storage down'))
        .mockRejectedValueOnce(new Error('storage down'))

      await expect(outbox.drainDue(NOW)).resolves.toBe(1)

      expect(remove.mock.calls).toEqual([
        [[GARMENT_FINAL]],
        [[SELFIE_STAGING]],
        [[MY_FORM_FINAL]],
      ])
      expect([...deletions.keys()]).toEqual([GARMENT_FINAL, SELFIE_STAGING])
      expect(updateMany.mock.calls).toEqual([
        [
          {
            where: { id: `deletion-${GARMENT_FINAL}` },
            data: {
              attempts: 1,
              last_error: 'Error',
              not_before: new Date(NOW.getTime() + FIVE_MINUTES_MS),
            },
          },
        ],
        [
          {
            where: { id: `deletion-${SELFIE_STAGING}` },
            data: {
              attempts: DELETION_ALERT_ATTEMPTS,
              last_error: 'Error',
              not_before: new Date(
                NOW.getTime() + FIVE_MINUTES_MS * 2 ** (DELETION_ALERT_ATTEMPTS - 1)
              ),
            },
          },
        ],
      ])
      expect(loggerMocks.child.warn).toHaveBeenCalledWith(
        { reason: 'garment_purged', attempts: 1, errorClass: 'Error' },
        'wardrobe_object_deletion_retry_failed'
      )
      expect(loggerMocks.child.error).toHaveBeenCalledExactlyOnceWith(
        {
          reason: 'garment_purged',
          attempts: DELETION_ALERT_ATTEMPTS,
          errorClass: 'Error',
        },
        'wardrobe_object_deletion_stuck'
      )
    })

    it('caps the backoff at one day', async () => {
      const row = deletionRow(GARMENT_FINAL, { attempts: 40 })
      due(row)
      findMany.mockResolvedValueOnce([row])
      remove.mockRejectedValueOnce(new Error('storage down'))

      await outbox.drainDue(NOW)

      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion-${GARMENT_FINAL}` },
        data: {
          attempts: 41,
          last_error: 'Error',
          not_before: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        },
      })
    })
  })
})
