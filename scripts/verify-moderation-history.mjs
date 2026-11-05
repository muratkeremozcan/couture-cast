// Story 6.13 owner: the catalog check behind `npm run moderation:history:verify`.
// It reads the catalog only and prints check names only, so its output can go in any log.
// It connects through DATABASE_URL, whichever role that is, and exits non-zero on any failed check.
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
// The API package is CommonJS, so its named exports arrive on the default export here.
import enforcementModule from '../apps/api/src/modules/moderation/moderation-history.enforcement.ts'

const { failedModerationHistoryChecks, MODERATION_HISTORY_ENFORCEMENT_CHECKS } =
  enforcementModule

async function main() {
  loadEnv({ quiet: true })
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('moderation:history:verify: DATABASE_URL is not set')
    return 2
  }
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const failed = await failedModerationHistoryChecks(
      async (sql) => (await client.query(sql)).rows
    )
    for (const { name } of MODERATION_HISTORY_ENFORCEMENT_CHECKS)
      console.log(`${failed.includes(name) ? 'FAIL' : 'ok  '} ${name}`)
    return failed.length === 0 ? 0 : 1
  } finally {
    await client.end()
  }
}

process.exitCode = await main().catch((error) => {
  // A driver message can name a host, so only the SQLSTATE leaves.
  console.error(`moderation:history:verify: could not run (${error?.code ?? 'unknown'})`)
  return 2
})
