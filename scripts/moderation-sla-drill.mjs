// Story 6.12 owner: the operations channel drill behind `npm run moderation:sla:drill`.
// It posts one `kind: 'drill'` payload through the real adapter, touches no table and names no case.
// `--local` runs against a loopback server, which proves the adapter with no configured webhook.
// The webhook URL is a secret, so nothing here ever prints it.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { config as loadEnv } from 'dotenv'
// Both packages are CommonJS, so their named exports arrive on the default export here.
import channelModule from '../apps/api/src/modules/moderation/moderation-sla.channel.ts'
import contractModule from '../packages/api-client/src/contracts/http/moderation-sla.ts'

const { createModerationOpsChannel, parseModerationOpsPushUserIds } = channelModule
const { moderationSlaDrillPayloadSchema } = contractModule

function drillPayload() {
  return moderationSlaDrillPayloadSchema.parse({
    id: `drill-${randomUUID()}`,
    kind: 'drill',
    detectedAt: new Date().toISOString(),
    text: 'Moderation SLA drill: this is a test of the operations channel. No case is affected.',
  })
}

async function runLocal() {
  const received = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      received.push(JSON.parse(body))
      response.writeHead(204).end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const channel = createModerationOpsChannel({ url: `http://127.0.0.1:${port}/drill` })
    const result = await channel.deliver(drillPayload())
    if (result !== 'delivered' || received.length !== 1) {
      return { ok: false, result }
    }
    moderationSlaDrillPayloadSchema.parse(received[0])
    return { ok: true, result }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean', default: false },
      'env-file': { type: 'string' },
    },
  })
  if (values['env-file']) loadEnv({ path: values['env-file'], quiet: true })

  if (values.local) {
    const { ok, result } = await runLocal()
    console.log(`moderation_sla_drill target=local result=${result}`)
    return ok ? 0 : 1
  }

  // The push channel reads moderator device tokens, so it needs the database; the webhook does not.
  const pushUserIds = parseModerationOpsPushUserIds(
    process.env.MODERATION_OPS_PUSH_USER_IDS
  )
  let prisma = null
  if (!process.env.MODERATION_OPS_WEBHOOK_URL?.trim() && pushUserIds.length > 0) {
    // The verified operator client: node-postgres against the committed Supabase root CA, host
    // name checked, the same trust the worker image uses. A bare PrismaClient would not verify it.
    const { default: operatorModule } = await import(
      '../apps/api/src/prisma/operator-prisma-client.ts'
    )
    prisma = operatorModule.createOperatorPrismaClient(process.env.DATABASE_URL ?? '')
  }
  const channel = createModerationOpsChannel({
    url: process.env.MODERATION_OPS_WEBHOOK_URL,
    push: prisma
      ? {
          userIds: pushUserIds,
          accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN,
          tokens: async (userIds) =>
            (
              await prisma.pushToken.findMany({
                where: { user_id: { in: [...userIds] }, permission: 'granted' },
                select: { token: true },
              })
            ).map((row) => row.token),
        }
      : undefined,
  })
  try {
    if (channel.kind === 'console') {
      console.error(
        'moderation_sla_drill result=unconfigured: neither MODERATION_OPS_WEBHOOK_URL nor MODERATION_OPS_PUSH_USER_IDS is set'
      )
      return 2
    }
    const result = await channel.deliver(drillPayload())
    console.log(`moderation_sla_drill target=${channel.kind} result=${result}`)
    return result === 'delivered' ? 0 : 1
  } finally {
    await prisma?.$disconnect()
  }
}

process.exitCode = await main()
