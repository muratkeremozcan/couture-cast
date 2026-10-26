// Assert the API's effective database after its normal environment loader has run.
import { PrismaClient } from '@prisma/client'
const expected = process.env.CC68_EXPECTED_DATABASE_URL
if (!expected || !/^\/tea_community_[a-f0-9]{32}$/.test(new URL(expected).pathname))
  throw new Error('owned_database_required')
// Build outputs are resolved at execution; the quality lane lints before the API build.
await import(new URL('../../apps/api/dist/src/load-env.js', import.meta.url).href)
if (process.env.DATABASE_URL !== expected) throw new Error('effective_database_mismatch')
const prisma = new PrismaClient({ datasourceUrl: expected })
try {
  const rows = await prisma.$queryRawUnsafe('SELECT current_database() AS name')
  if (rows[0]?.name !== new URL(expected).pathname.slice(1))
    throw new Error('effective_database_mismatch')
} finally {
  await prisma.$disconnect()
}
console.log(
  JSON.stringify({
    code: 'owned_database_verified',
    database: new URL(expected).pathname.slice(1),
  })
)
await import(new URL('../../apps/api/dist/src/main.js', import.meta.url).href)
