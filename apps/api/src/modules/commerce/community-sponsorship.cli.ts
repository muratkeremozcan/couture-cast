import { readFileSync } from 'node:fs'
import { parseArgs, parseEnv } from 'node:util'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../../prisma/prisma-client.js'
import {
  CommunitySponsorshipOperatorService,
  CommunitySponsorshipRefusal,
} from './community-sponsorship-operator.service.js'

/**
 * Story 6.7b: `npm run community:sponsorship -- link|end ...`, the owner's
 * audited operator command. `scripts/community-sponsorship.ts` is the `tsx`
 * entry; everything it does lives here so it is unit tested with the API.
 *
 * TARGETING. `--env-file` is required and is the only source of
 * `DATABASE_URL`; the ambient environment is ignored, so a shell that happens
 * to export a production URL cannot be written to by accident. A loopback host
 * runs as is. Any other host also needs `--confirm-target <project ref>` equal
 * to the ref parsed from the URL, and a remote URL whose ref cannot be parsed is
 * refused.
 */

export const COMMUNITY_SPONSORSHIP_USAGE = `Usage:
  npm run community:sponsorship -- link --env-file <path> --actor-email <email>
    --post <postId> --offer <offerId> --reason <partner_campaign|owner_pick>
    --author-agreement <agr_ULID> [--starts-at <ISO>] [--ends-at <ISO>]
    [--confirm-target <project ref>] [--dry-run]
  npm run community:sponsorship -- end --env-file <path> --actor-email <email>
    --post <postId>
    --reason <campaign_ended|author_withdrew|partner_inactive|correction>
    [--confirm-target <project ref>] [--dry-run]

Times are ISO 8601 with Z or an explicit offset. --starts-at defaults to the
database clock; --ends-at defaults to open-ended.`

export const EXIT_OK = 0
export const EXIT_REFUSED = 1
export const EXIT_USAGE = 2

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type SponsorshipTarget =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly ref: string }

export class SponsorshipTargetRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SponsorshipTargetRefusal'
  }
}

/**
 * Decides whether this command may write to `databaseUrl`. Node's `URL`
 * reports an IPv6 loopback host as `[::1]`, so brackets are removed before
 * the loopback check.
 */
export function resolveSponsorshipTarget(
  databaseUrl: string,
  confirmTarget: string | undefined
): SponsorshipTarget {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new SponsorshipTargetRefusal('DATABASE_URL in --env-file is not a valid URL.')
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (LOOPBACK_HOSTS.has(host)) return { kind: 'local' }

  const ref =
    /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1] ??
    /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1]
  if (!ref) {
    throw new SponsorshipTargetRefusal(
      'DATABASE_URL points at a remote host whose project ref cannot be parsed; refusing.'
    )
  }
  if (confirmTarget !== ref) {
    throw new SponsorshipTargetRefusal(
      `DATABASE_URL targets remote project ${ref}; pass --confirm-target ${ref} to write to it.`
    )
  }
  return { kind: 'remote', ref }
}

export type CommunitySponsorshipCliDeps = {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly readEnvFile: (path: string) => string
  readonly createPrisma: (databaseUrl: string) => PrismaClient
}

const defaultDeps: CommunitySponsorshipCliDeps = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readEnvFile: (path) => readFileSync(path, 'utf8'),
  createPrisma: (databaseUrl) =>
    createPrismaClient({ datasources: { db: { url: databaseUrl } } }),
}

class UsageError extends Error {}

const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

function parseTime(name: string, raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined
  const parsed = new Date(raw)
  if (!ISO_WITH_ZONE.test(raw) || Number.isNaN(parsed.getTime())) {
    throw new UsageError(`--${name} must be ISO 8601 with Z or an explicit offset.`)
  }
  return parsed
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new UsageError(`--${name} is required.`)
  }
  return value
}

type ParsedCommand = {
  readonly command: 'link' | 'end'
  readonly envFile: string
  readonly confirmTarget: string | undefined
  readonly actorEmail: string
  readonly postId: string
  readonly offerId: string | undefined
  readonly reason: string
  readonly authorAgreement: string | undefined
  readonly startsAt: Date | undefined
  readonly endsAt: Date | undefined
  readonly dryRun: boolean
}

function parseCommand(argv: readonly string[]): ParsedCommand | 'help' {
  let parsed: ReturnType<typeof parseCliArgs>
  try {
    parsed = parseCliArgs(argv)
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const { values, positionals } = parsed
  if (values.help) return 'help'

  const command = positionals[0]
  if ((command !== 'link' && command !== 'end') || positionals.length !== 1) {
    throw new UsageError('The first argument must be link or end.')
  }
  if (command === 'end') {
    for (const flag of ['offer', 'author-agreement', 'starts-at', 'ends-at'] as const) {
      if (values[flag] !== undefined)
        throw new UsageError(`--${flag} applies to link only.`)
    }
  }

  return {
    command,
    envFile: required('env-file', values['env-file']),
    confirmTarget: values['confirm-target'],
    actorEmail: required('actor-email', values['actor-email']),
    postId: required('post', values.post),
    offerId: command === 'link' ? required('offer', values.offer) : undefined,
    reason: required('reason', values.reason),
    authorAgreement:
      command === 'link'
        ? required('author-agreement', values['author-agreement'])
        : undefined,
    startsAt: parseTime('starts-at', values['starts-at']),
    endsAt: parseTime('ends-at', values['ends-at']),
    dryRun: values['dry-run'] ?? false,
  }
}

function parseCliArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      'env-file': { type: 'string' },
      'confirm-target': { type: 'string' },
      'actor-email': { type: 'string' },
      post: { type: 'string' },
      offer: { type: 'string' },
      reason: { type: 'string' },
      'author-agreement': { type: 'string' },
      'starts-at': { type: 'string' },
      'ends-at': { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
}

function loadDatabaseUrl(deps: CommunitySponsorshipCliDeps, envFile: string): string {
  let contents: string
  try {
    contents = deps.readEnvFile(envFile)
  } catch {
    throw new UsageError(`--env-file ${envFile} cannot be read.`)
  }
  const value: unknown = new Map(Object.entries(parseEnv(contents))).get('DATABASE_URL')
  const databaseUrl = typeof value === 'string' ? value.trim() : undefined
  if (!databaseUrl) throw new UsageError(`--env-file ${envFile} has no DATABASE_URL.`)
  return databaseUrl
}

function serialize(outcome: object): string {
  return JSON.stringify(outcome, (_key, value: unknown) =>
    value instanceof Date ? value.toISOString() : value
  )
}

/** Runs one command and returns the process exit code. */
export async function runCommunitySponsorshipCli(
  argv: readonly string[],
  deps: CommunitySponsorshipCliDeps = defaultDeps
): Promise<number> {
  let command: ParsedCommand
  let target: SponsorshipTarget
  let databaseUrl: string
  try {
    const parsed = parseCommand(argv)
    if (parsed === 'help') {
      deps.stdout(COMMUNITY_SPONSORSHIP_USAGE)
      return EXIT_OK
    }
    command = parsed
    databaseUrl = loadDatabaseUrl(deps, command.envFile)
    target = resolveSponsorshipTarget(databaseUrl, command.confirmTarget)
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      deps.stderr(`community:sponsorship: ${error.message}`)
      deps.stderr(COMMUNITY_SPONSORSHIP_USAGE)
      return EXIT_USAGE
    }
    if (error instanceof SponsorshipTargetRefusal) {
      deps.stderr(`community:sponsorship refused: ${error.message}`)
      return EXIT_REFUSED
    }
    throw error
  }

  const prisma = deps.createPrisma(databaseUrl)
  try {
    const operator = new CommunitySponsorshipOperatorService(prisma)
    const outcome =
      command.command === 'link'
        ? await operator.link({
            actorEmail: command.actorEmail,
            postId: command.postId,
            offerId: command.offerId ?? '',
            reason: command.reason,
            authorAgreement: command.authorAgreement ?? '',
            startsAt: command.startsAt,
            endsAt: command.endsAt,
            dryRun: command.dryRun,
          })
        : await operator.end({
            actorEmail: command.actorEmail,
            postId: command.postId,
            reason: command.reason,
            dryRun: command.dryRun,
          })
    deps.stdout(
      serialize({
        command: command.command,
        target: target.kind === 'local' ? 'local' : target.ref,
        ...outcome,
      })
    )
    return EXIT_OK
  } catch (error: unknown) {
    if (error instanceof CommunitySponsorshipRefusal) {
      deps.stderr(`community:sponsorship refused (${error.code}): ${error.message}`)
      return EXIT_REFUSED
    }
    deps.stderr(
      `community:sponsorship failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return EXIT_REFUSED
  } finally {
    await prisma.$disconnect()
  }
}
