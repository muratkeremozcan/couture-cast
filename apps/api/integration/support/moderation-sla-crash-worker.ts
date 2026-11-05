// Story 6.12 test owner: the real sweep and the real adapter in a process the test kills with SIGKILL
// while its POST is in flight. I-D-CRASH-AFTER-POST.
import { PrismaClient } from '@prisma/client'
import { createModerationOpsChannel } from '../../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaSweep } from '../../src/modules/moderation/moderation-sla.sweep.js'

const [databaseUrl, webhookUrl, nowIso] = process.argv.slice(2)
if (!databaseUrl || !webhookUrl || !nowIso) {
  throw new Error(
    'usage: moderation-sla-crash-worker.ts <database url> <webhook url> <now>'
  )
}
const noop = () => undefined

async function main(database: string, webhook: string, now: string) {
  const prisma = new PrismaClient({ datasourceUrl: database })
  await new ModerationSlaSweep({
    prisma,
    clock: () => new Date(now),
    // The receiver holds this request open. The test kills the process long before the timeout.
    channel: createModerationOpsChannel({ url: webhook, timeoutMs: 120_000 }),
    flags: { getFeatureFlag: () => Promise.resolve(true) } as never,
    analytics: { capture: noop },
    logger: { info: noop, warn: noop, error: noop } as never,
    meter: {
      setOpenCases: noop,
      setOldestPendingReviewAgeSeconds: noop,
      countAlert: noop,
      countDeliveryFailure: noop,
    },
    // Same value as the harness sweep, so the resend can be compared byte for byte.
    appUrl: 'https://app.test',
  }).run()
  await prisma.$disconnect()
}

void main(databaseUrl, webhookUrl, nowIso)
