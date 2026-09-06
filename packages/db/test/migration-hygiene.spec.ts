// Three guards over the hand-authored migration SQL. All three exist because the
// same bug class keeps appearing here — a divergence between what a migration
// says and what a database actually holds, which no existing gate could see.
//
// Class 1 — identifier truncation. PostgreSQL silently shortens any identifier
// past 63 bytes. It does not warn, and the shortened name is what ends up in
// the catalog, so the migration and the database disagree from the moment the
// migration is applied. That happened to
// `AlertDeliveryOutbox_deduplication_key_reservation_started_at_idx` (64 bytes):
// Postgres cut the trailing `_idx`, Prisma truncates the same logical name
// differently (it preserves the suffix), and `prisma migrate diff` reported a
// phantom rename on every clean checkout from then on.
//
// Class 2 — objects the Prisma DSL cannot express. Partial indexes, expression
// indexes and exclusion constraints exist only in hand-authored SQL, and Prisma's
// introspection SKIPS them, so it cannot see them in the database. If nothing
// re-asserts them, a regenerated migration can drop the predicate that makes one
// of them correct and nothing fails. `AffiliateOffer_status_..._priority_idx` was
// the live example: declared in schema.prisma as a plain `@@index` whose derived
// name is byte-identical to the real partial index, which would have made the
// next `prisma migrate dev` either fail with 42P07 or quietly recreate the index
// without its `WHERE advisor_slot IS NOT NULL`.
//
// Class 3 — a migration amended after a database already applied it. Prisma 6.19
// reports such a database as up to date, measured with a control, so the drift is
// invisible to `migrate status` and `migrate deploy` alike. DB-HYGIENE-03 carries
// the argument and the evidence.
//
// All three guards are data-driven from the migrations folder, so a new partial
// index, a new over-long name or a newly amended migration is covered the day it
// lands rather than the day someone notices the drift.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 2 })

const migrationsDirectory = fileURLToPath(
  new URL('../prisma/migrations', import.meta.url)
)

/** PostgreSQL's NAMEDATALEN - 1. Identifiers past this are truncated silently. */
const MAX_IDENTIFIER_BYTES = 63

type Migration = { name: string; sql: string }

const readMigrations = (): Migration[] =>
  readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Directory names are timestamp-prefixed, so lexical order is apply order.
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(migrationsDirectory, entry.name, 'migration.sql'), 'utf8'),
    }))

const migrations = readMigrations()

const lineOf = (sql: string, offset: number) => sql.slice(0, offset).split('\n').length

type UnrepresentableObject = {
  migration: string
  kind: 'index' | 'exclusion'
  partial: boolean
}

const CREATE_INDEX =
  /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?[^;]*;/gi
const DROP_INDEX =
  /DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gi
const EXCLUDE_CONSTRAINT =
  /ADD\s+CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?\s+EXCLUDE\s+USING/gi

/**
 * True when the index carries something the Prisma DSL cannot say, which is
 * also what makes Prisma's introspection skip it: a `WHERE` predicate, a
 * function call in the column list, or a cast.
 *
 * `"name" gin_trgm_ops` is deliberately NOT one of these — an operator class is
 * expressible as `@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)`, and the
 * three trigram indexes in this schema are declared that way.
 */
const classifyIndex = (statement: string) => {
  const partial = / WHERE /i.test(statement)
  const onIndex = statement.indexOf(' ON ')
  const columns =
    onIndex === -1 ? '' : statement.slice(statement.indexOf('(', onIndex) + 1)
  const expression = /\w+\s*\(/.test(columns) || columns.includes('::')

  return { partial, unrepresentable: partial || expression }
}

/**
 * Walks the migrations in apply order and returns the partial indexes,
 * expression indexes and exclusion constraints still standing at the end:
 * created, and not dropped by a later migration.
 */
const collectUnrepresentableObjects = (): Map<string, UnrepresentableObject> => {
  const live = new Map<string, UnrepresentableObject>()

  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(CREATE_INDEX)) {
      const statement = match[0].replace(/\s+/g, ' ')
      const { partial, unrepresentable } = classifyIndex(statement)

      if (unrepresentable) {
        live.set(match[1] ?? '', { migration: migration.name, kind: 'index', partial })
      }
    }

    for (const match of migration.sql.matchAll(DROP_INDEX)) {
      live.delete(match[1] ?? '')
    }

    for (const match of migration.sql.matchAll(EXCLUDE_CONSTRAINT)) {
      live.set(match[1] ?? '', {
        migration: migration.name,
        kind: 'exclusion',
        partial: false,
      })
    }
  }

  return live
}

afterAll(async () => {
  await adminPool.end()
})

describe('migration hygiene', () => {
  it('DB-HYGIENE-01 keeps every identifier within PostgreSQL 63-byte limit', () => {
    // Double-quoted strings in SQL are always identifiers (literals use single
    // quotes), and the unquoted pattern catches names written bare after the
    // keywords that introduce one -- policies and constraints usually are.
    const quoted = /"([^"\n]+)"/g
    const unquoted =
      /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?|CREATE\s+POLICY|ADD\s+CONSTRAINT|CONSTRAINT|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|CREATE\s+TYPE|ALTER\s+INDEX)\s+([A-Za-z_][A-Za-z0-9_$]*)/gi

    const violations: string[] = []
    let scanned = 0

    for (const migration of migrations) {
      for (const pattern of [quoted, unquoted]) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(migration.sql)) !== null) {
          const identifier = match[1] ?? ''
          scanned += 1
          const bytes = Buffer.byteLength(identifier, 'utf8')
          if (bytes > MAX_IDENTIFIER_BYTES) {
            violations.push(
              `${migration.name}/migration.sql:${lineOf(migration.sql, match.index)} ` +
                `(${bytes} bytes) ${identifier}`
            )
          }
        }
      }
    }

    // GUARDS THIS TEST'S OWN PREMISE, the way DB-HYGIENE-02 guards its `live.size`.
    //
    // Everything above is `violations.push` inside two regex loops, so the
    // assertion at the end is `[] === []` whenever the loops find nothing to
    // look at — an empty migrations directory, a `readMigrations` pointed at the
    // wrong path, or either pattern rewritten until it stops matching. None of
    // those is hypothetical: the whole file is regex over hand-authored SQL, and
    // the identifier that motivated it is one character over the limit. A guard
    // that silently stops guarding is the failure this file exists to prevent,
    // and the same shape was found live in 6.1-DB-034, which was green in CI
    // since it landed while sweeping zero rows.
    //
    // Both floors sit well under the measured values — 38 migrations and 2,187
    // identifiers on 2026-09-06 — so ordinary churn does not trip them.
    expect(migrations.length, 'no migrations were read to scan').toBeGreaterThan(20)
    expect(scanned, 'the identifier patterns matched nothing').toBeGreaterThan(500)

    // A failure here is not cosmetic. PostgreSQL will accept the migration and
    // store a shortened name, after which the catalog and the migration text
    // disagree permanently: `DROP INDEX "<full name>"` in a later migration
    // fails, and `prisma migrate diff` reports a rename forever. Shorten the
    // name in the migration instead of suppressing this.
    expect(violations).toEqual([])
  })

  it('DB-HYGIENE-02 keeps every predicate and expression Prisma cannot express', async () => {
    const live = collectUnrepresentableObjects()

    // If this is ever zero the guard has stopped guarding anything, which most
    // likely means the parsing above broke rather than that the SQL changed.
    expect(live.size).toBeGreaterThan(0)

    const client = await adminPool.connect()

    try {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        'SELECT "indexname", "indexdef" FROM pg_indexes WHERE "schemaname" = \'public\''
      )
      const definitionByName = new Map(
        indexes.rows.map((row) => [row.indexname, row.indexdef])
      )

      const constraints = await client.query<{ conname: string }>(
        `SELECT "conname" FROM pg_constraint
         WHERE "connamespace" = 'public'::regnamespace AND "contype" = 'x'`
      )
      const exclusionNames = new Set(constraints.rows.map((row) => row.conname))

      const missing: string[] = []
      const lostPredicate: string[] = []

      for (const [name, object] of live) {
        if (object.kind === 'exclusion') {
          if (!exclusionNames.has(name)) {
            missing.push(`${object.migration}: exclusion constraint ${name}`)
          }
          continue
        }

        const definition = definitionByName.get(name)

        if (definition === undefined) {
          missing.push(`${object.migration}: index ${name}`)
        } else if (object.partial && !/ WHERE /i.test(definition)) {
          // Present, but no longer partial: something recreated it without the
          // predicate. That is the silent half of this bug class, and the
          // reason this reads the live definition rather than just the name.
          lostPredicate.push(`${object.migration}: index ${name} -> ${definition}`)
        }
      }

      expect(lostPredicate).toEqual([])
      expect(missing).toEqual([])
    } finally {
      client.release()
    }
  })

  it('DB-HYGIENE-03 keeps applied migration history matching the migration files', async () => {
    // Class 3 — a migration amended after it was already applied.
    //
    // PRISMA DOES NOT DETECT THIS, which is the whole reason the check exists.
    // Measured on 6.19.0 against a database whose recorded checksum for
    // `20260905120000` demonstrably differed from the file: `migrate deploy`
    // reported "No pending migrations to apply" and `migrate status` reported
    // "Database schema is up to date!", both exit 0. That result was taken with a
    // control — deleting one applied row made `migrate status` exit 1 and name the
    // migration — so the clean answer is Prisma reading the history and declining
    // to care, not an inert command. The documentation implies otherwise; the
    // measurement is what this comment rests on.
    //
    // WHY IT MATTERS depends on what the amendment did, and the two live examples
    // on this branch are one of each. `20260713170000` renamed a 64-byte index to
    // the 63-byte text PostgreSQL had already truncated it to, so a database that
    // applied either version is in the identical state: harmless. The Story 6.1
    // migration's `EngagementEvent` REVOKE is new DDL, so a database holding that
    // migration as applied has never executed it and simply does not have the
    // lockdown, while `migrate status` calls it up to date.
    //
    // THIS IS PERMANENTLY GREEN IN CI, and that is not evidence it does nothing.
    // CI creates the database and applies every migration from scratch on each
    // run, so its history can never diverge. The population this protects is
    // developer machines, which is exactly where a `db:reset` from before an
    // amendment leaves a schema that looks current and is not.
    const client = await adminPool.connect()

    try {
      const history = await client.query<{ migration_name: string; checksum: string }>(
        'SELECT "migration_name", "checksum" FROM public."_prisma_migrations"'
      )
      const recorded = new Map(
        history.rows.map((row) => [row.migration_name, row.checksum])
      )

      // Prisma stores the SHA-256 of the migration file's raw bytes. Verified
      // rather than assumed: 36 of the 38 migrations on this branch hash to their
      // recorded value exactly, which is only possible if the algorithm is this
      // one, and the two that do not are the two known amendments.
      const drifted: string[] = []
      let compared = 0

      for (const migration of migrations) {
        const checksum = recorded.get(migration.name)
        // A migration that is present on disk and absent from history is simply
        // pending. `migrate status` already reports that, and a developer who has
        // pulled a branch and not yet reset is in a normal state, so it is not
        // this check's business.
        if (checksum === undefined) continue

        compared += 1
        const actual = createHash('sha256')
          .update(
            readFileSync(join(migrationsDirectory, migration.name, 'migration.sql'))
          )
          .digest('hex')

        if (actual !== checksum) {
          drifted.push(migration.name)
        }
      }

      // ANCHORED, because a detector for a silent divergence must not diverge
      // silently itself. `drifted` is empty when every file matches AND when
      // nothing was compared at all: an empty `_prisma_migrations`, a connection
      // pointed at the wrong database, or a repointed migrations directory would
      // each produce a confident green over zero comparisons. The floor sits well
      // under the 38 rows measured on 2026-09-06.
      expect(compared, 'no applied migrations were compared').toBeGreaterThan(20)

      expect(
        drifted,
        'These migration files changed after this database applied them, so its ' +
          'schema is NOT what the files say even though `prisma migrate status` ' +
          'reports it up to date. Run `npm run db:reset` to rebuild from the ' +
          'current files. If you are seeing this in CI, something is reusing a ' +
          'database across runs and that is the real defect.'
      ).toEqual([])
    } finally {
      client.release()
    }
  })
})
