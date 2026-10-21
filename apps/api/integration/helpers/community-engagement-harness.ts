// Story 6.5 acceptance owner: real isolated DB/process/provider and fault boundaries.
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createTeenUser,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './isolated-community-database.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../../src/modules/community/community-send-guard.js'
import { CommunityFlagEvaluationService } from '../../src/modules/feature-flags/community-flag-evaluation.service.js'
import { PushRegistrationService } from '../../src/modules/notifications/push-registration.service.js'
import { recordCommunityEngagement } from '../../src/modules/community/community-engagement-intent.js'

const envelope = z.object({
  id: z.number().optional(),
  event: z.string().optional(),
  value: z.unknown().optional(),
  error: z.string().optional(),
})
export const readySchema = z.object({
  pid: z.number(),
  port: z.number().optional(),
  backend: z.number().optional(),
  version: z.number().optional(),
})
export const ledgerSchema = z.array(
  z.object({
    accepted: z.boolean(),
    acceptedAt: z.number().nullable(),
    ordinal: z.number(),
    at: z.number(),
    wall: z.number(),
    type: z.string(),
    keys: z.array(z.string()),
  })
)
export async function until<T>(
  read: () => Promise<T>,
  accepted: (value: T) => boolean,
  timeout = 4000
): Promise<T> {
  const deadline = performance.now() + timeout
  do {
    const result = await read()
    if (accepted(result)) return result
    await delay(10)
  } while (performance.now() < deadline)
  throw new Error('Owned acceptance barrier deadline exceeded')
}
export class OwnedProcess {
  readonly child: ChildProcess
  private sequence = 0
  private readonly events: { name: string; value: unknown }[] = []
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private exited = false
  constructor(file: string, variables: NodeJS.ProcessEnv = {}) {
    this.child = fork(resolve(__dirname, '../support', file), [], {
      execArgv: [],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        TEST_ENV: 'local',
        LOG_LEVEL: 'fatal',
        DISABLE_FILE_LOGS: 'true',
        ...variables,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    console.log(
      JSON.stringify({ evidence: 'owned-child-start', pid: this.child.pid, script: file })
    )
    this.child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    this.child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    this.child.on('message', (raw) => {
      const message = envelope.parse(raw)
      if (message.event) this.events.push({ name: message.event, value: message.value })
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id)
        if (!waiting) return
        clearTimeout(waiting.timer)
        this.pending.delete(message.id)
        if (message.error)
          waiting.reject(new Error(`Owned child failure: ${message.error}`))
        else waiting.resolve(message.value)
      }
    })
    this.child.on('exit', (code, signal) => {
      console.log(
        JSON.stringify({
          evidence: 'owned-child-exit',
          pid: this.child.pid,
          code,
          signal,
        })
      )
      this.exited = true
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error('Owned child exited during operation'))
      }
      this.pending.clear()
    })
  }
  call(op: string, args?: unknown, timeout = 20_000): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error('Owned child already exited'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Owned ${op} deadline exceeded`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.child.send({ id, op, args })
    })
  }
  async event(name: string, timeout = 5000) {
    const event = await until(
      () => Promise.resolve(this.events.find((entry) => entry.name === name)),
      Boolean,
      timeout
    )
    this.events.splice(this.events.indexOf(event!), 1)
    return event!.value
  }
  signal(signal: NodeJS.Signals) {
    if (!this.exited) this.child.kill(signal)
  }
  async close() {
    if (!this.exited) {
      this.signal('SIGCONT')
      await this.call('close')
      await until(() => Promise.resolve(this.exited), Boolean)
    }
  }
}
export async function engagementHarness() {
  const database = isolatedCommunityDatabase()
  await database.migrate()
  const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
  const [server] = await prisma.$queryRaw<
    { version: number }[]
  >`SELECT current_setting('server_version_num')::integer AS version`
  if (!server || server.version < 170000) {
    await prisma.$disconnect()
    await database.drop()
    throw new Error('Acceptance requires actual PostgreSQL17+')
  }
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  const children: OwnedProcess[] = []
  const spawn = (file: string, variables: NodeJS.ProcessEnv = {}) => {
    const child = new OwnedProcess(file, variables)
    children.push(child)
    return child
  }
  const provider = spawn('community-provider-recorder.mjs')
  const ready = readySchema.parse(await provider.event('ready'))
  const endpoint = `http://127.0.0.1:${ready.port}/push`
  const flags = new CommunityFlagEvaluationService(prisma, {
    getFeatureFlagValue: () => Promise.resolve(true),
  })
  const guard = new CommunitySendGuard(prisma, flags)
  const worker = new CommunityNotificationsWorker(prisma, guard)
  return {
    prisma,
    database,
    provider,
    endpoint,
    flags,
    worker,
    version: server.version,
    ledger: async () => ledgerSchema.parse(await provider.call('ledger')),
    spawn,
    async sender(options: { proxy?: string; owner?: 'general' | 'community' } = {}) {
      const child = spawn('community-engagement-worker.mjs', {
        STORY65_WORKER_DATABASE_URL: options.proxy ?? database.url,
        STORY65_PROVIDER_ENDPOINT: endpoint,
        DATABASE_URL: options.proxy ?? database.url,
        COMMUNITY_GUARD_DATABASE_URL: options.proxy ?? database.url,
        COMMUNITY_DISPATCH_ENABLED: 'true',
        COMMUNITY_ENGAGEMENT_OWNER: options.owner ?? 'general',
      })
      const state = readySchema.parse(await child.event('ready', 10_000))
      return { child, ...state }
    },
    async proxy() {
      const child = spawn('community-db-fault-proxy.mjs', {
        STORY65_PROXY_TARGET: database.url,
      })
      const state = readySchema.parse(await child.event('ready'))
      const url = new URL(database.url)
      url.port = String(state.port)
      return { child, url: url.toString() }
    },
    async fixture(kind: 'reaction' | 'reply' = 'reaction', teenActor = false) {
      const make = () =>
        persistUser(
          prisma,
          createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
        )
      const author = await make()
      const actor = teenActor
        ? await persistUser(
            prisma,
            createTeenUser({
              profilePreferences: { compliance: { accountStatus: 'active' } },
            })
          )
        : await make()
      const parentAuthor = await make()
      if (teenActor)
        await prisma.guardianConsent.create({
          data: { guardian_id: author.id, teen_id: actor.id, status: 'granted' },
        })
      const recipient = kind === 'reply' ? parentAuthor : author
      const post = await prisma.lookbookPost.create({
        data: buildLookbookPostCreateInput(
          createLookbookPost({ userId: author.id, status: 'published' })
        ),
      })
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${recipient.id}]::text[],ARRAY[]::text[],true)`
        await tx.notificationPreference.create({ data: { user_id: recipient.id } })
        await tx.communityNotificationPreference.create({
          data: { user_id: recipient.id, enabled: true },
        })
      })
      const token = `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`
      const installation = randomUUID()
      const binding = await new PushRegistrationService(prisma).register(recipient.id, {
        token,
        installationId: installation,
        permission: 'granted',
        platform: 'ios',
      })
      let parent: { id: string } | undefined
      let comment: { id: string } | undefined
      if (kind === 'reply') {
        const data = {
          post_id: post.id,
          body: 'Synthetic acceptance contribution',
          locale: 'en-US',
          platform: 'web',
          status: 'published' as const,
          published_at: new Date(),
        }
        parent = await prisma.communityComment.create({
          data: { ...data, user_id: parentAuthor.id, publication_sequence: 1 },
        })
        comment = await prisma.$transaction(async (tx) => {
          const result = await tx.communityComment.create({
            data: {
              ...data,
              user_id: actor.id,
              parent_id: parent!.id,
              publication_sequence: 2,
            },
          })
          await recordCommunityEngagement(tx, {
            actor: actor.id,
            post: post.id,
            comment: result.id,
          })
          return result
        })
      } else
        await new CommunityRepository(prisma).setReaction({
          userId: actor.id,
          postId: post.id,
          platform: 'web',
          input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
          assertEligible: () => Promise.resolve(),
        })
      await worker.group()
      await worker.fanout()
      const delivery = await prisma.communityTokenDelivery.findFirstOrThrow({
        where: { owner_id: recipient.id, group: { post_id: post.id } },
      })
      return {
        author,
        actor,
        parentAuthor,
        recipient,
        post,
        parent,
        comment,
        delivery,
        binding,
        token,
        installation,
      }
    },
    async close() {
      const outcomes = await Promise.allSettled(children.map((child) => child.close()))
      await prisma.$disconnect()
      await database.drop()
      const errors = outcomes.filter((result) => result.status === 'rejected')
      if (errors.length)
        throw new AggregateError(
          errors.map((result) =>
            result.reason instanceof Error
              ? result.reason
              : new Error('Owned child cleanup failed')
          ),
          'Owned harness cleanup failed'
        )
    },
  }
}
export type EngagementHarness = Awaited<ReturnType<typeof engagementHarness>>
export const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 'fulfilled' as const }),
    () => ({ status: 'rejected' as const })
  )
