import { vi } from 'vitest'

/** One `WardrobeObjectDeletion` row as the in-memory table holds it. */
export type DeletionRow = {
  id: string
  object_path: string
  reason: string
  not_before: Date
  attempts: number
  last_error: string | null
  /** Round 5: set on a removal that repeats until then. */
  repeat_until: Date | null
}

type RepeatUntilWhere = null | { lt: Date }

type DeletionWhere = {
  id?: string
  object_path?: string | { in: string[] }
  not_before?: { lt?: Date }
  OR?: { repeat_until: RepeatUntilWhere }[]
}

function repeatUntilMatches(row: DeletionRow, where: RepeatUntilWhere): boolean {
  if (where === null) return row.repeat_until === null
  return row.repeat_until !== null && row.repeat_until < where.lt
}

function matches(row: DeletionRow, where: DeletionWhere): boolean {
  const path = where.object_path
  if (typeof path === 'string' && row.object_path !== path) return false
  if (path && typeof path === 'object' && !path.in.includes(row.object_path)) return false
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.not_before?.lt && !(row.not_before < where.not_before.lt)) return false
  if (
    where.OR &&
    !where.OR.some((branch) => repeatUntilMatches(row, branch.repeat_until))
  ) {
    return false
  }
  return true
}

/**
 * The deletion outbox as a small in-memory table for unit specs (round 4). What a service
 * records is what the outbox later finds, defers, retries and deletes, so a spec reads the
 * obligations the way the database holds them instead of scripting each outbox read. A row
 * recorded without `not_before` is due from the moment it is written, as the column default
 * makes it. Every method is a spy, so calls stay assertable too.
 */
export function createDeletionTable() {
  const rows = new Map<string, DeletionRow>()
  let nextId = 1
  return {
    rows,
    createMany: vi.fn(
      (args: {
        data: {
          object_path: string
          reason: string
          not_before?: Date
          repeat_until?: Date
        }[]
        skipDuplicates?: boolean
      }) => {
        let count = 0
        for (const entry of args.data) {
          if (rows.has(entry.object_path)) continue
          rows.set(entry.object_path, {
            id: `deletion-${nextId++}`,
            object_path: entry.object_path,
            reason: entry.reason,
            not_before: entry.not_before ?? new Date(),
            attempts: 0,
            last_error: null,
            repeat_until: entry.repeat_until ?? null,
          })
          count += 1
        }
        return Promise.resolve({ count })
      }
    ),
    updateMany: vi.fn((args: { where: DeletionWhere; data: Record<string, unknown> }) => {
      let count = 0
      for (const row of rows.values()) {
        if (!matches(row, args.where)) continue
        const { attempts, ...rest } = args.data
        Object.assign(row, rest)
        if (typeof attempts === 'number') row.attempts = attempts
        else if (attempts && typeof attempts === 'object') row.attempts += 1
        count += 1
      }
      return Promise.resolve({ count })
    }),
    findUnique: vi.fn((args: { where: { object_path: string } }) =>
      Promise.resolve(rows.get(args.where.object_path) ?? null)
    ),
    findMany: vi.fn(
      (args: {
        where: {
          not_before?: { lte: Date }
          object_path?: { startsWith: string } | { in: string[] }
        }
      }) => {
        const { not_before: due, object_path: path } = args.where
        return Promise.resolve(
          [...rows.values()]
            .filter((row) => !due || row.not_before <= due.lte)
            .filter(
              (row) =>
                !path ||
                ('startsWith' in path
                  ? row.object_path.startsWith(path.startsWith)
                  : path.in.includes(row.object_path))
            )
            .sort((a, b) => a.not_before.getTime() - b.not_before.getTime())
        )
      }
    ),
    update: vi.fn((args: { where: { id: string }; data: Partial<DeletionRow> }) => {
      const row = [...rows.values()].find((entry) => entry.id === args.where.id)
      if (row) Object.assign(row, args.data)
      return Promise.resolve(row)
    }),
    delete: vi.fn((args: { where: { id: string } }) => {
      const row = [...rows.values()].find((entry) => entry.id === args.where.id)
      if (row) rows.delete(row.object_path)
      return Promise.resolve(row)
    }),
    deleteMany: vi.fn((args: { where: DeletionWhere }) => {
      let count = 0
      for (const row of [...rows.values()]) {
        if (!matches(row, args.where)) continue
        rows.delete(row.object_path)
        count += 1
      }
      return Promise.resolve({ count })
    }),
  }
}

export type DeletionTable = ReturnType<typeof createDeletionTable>
