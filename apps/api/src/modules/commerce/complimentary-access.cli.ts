// Story 6.14 operator owner: argument parsing, targeting and exit codes for
// `npm run access:complimentary`, with the transaction in `complimentary-access-operator.service.ts`.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../../prisma/prisma-client.js'
import {
  ComplimentaryAccessOperatorService,
  ComplimentaryAccessRefusal,
} from './complimentary-access-operator.service.js'
import {
  OperatorTargetRefusal,
  readOperatorDatabaseUrl,
  resolveOperatorTarget,
  type OperatorTarget,
} from './operator-cli-target.js'

/**
 * Story 6.14 D7: `npm run access:complimentary -- grant|revoke|list ...`, the owner's audited
 * operator command. `scripts/complimentary-access.ts` is the `tsx` entry; everything it does
 * lives here so it is unit tested with the API. Targeting is the 6.7b rule in
 * `operator-cli-target.ts`: `--env-file` is the only `DATABASE_URL` source, and a remote host
 * also needs `--confirm-target <project ref>`.
 */
export const COMPLIMENTARY_ACCESS_USAGE = `Usage:
  npm run access:complimentary -- grant --env-file <path> --actor-email <email>
    --member-email <email> --reason <text> [--confirm-target <project ref>] [--dry-run]
  npm run access:complimentary -- revoke --env-file <path> --actor-email <email>
    --member-email <email> --reason <text> [--confirm-target <project ref>] [--dry-run]
  npm run access:complimentary -- list --env-file <path> --actor-email <email>
    [--confirm-target <project ref>]

--reason is 1 to 200 characters. The actor must be an auth user with app_role admin.`

export const EXIT_OK = 0
export const EXIT_REFUSED = 1
export const EXIT_USAGE = 2

export type ComplimentaryAccessCliDeps = {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly readEnvFile: (path: string) => string
  readonly createPrisma: (databaseUrl: string) => PrismaClient
}

const defaultDeps: ComplimentaryAccessCliDeps = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readEnvFile: (path) => readFileSync(path, 'utf8'),
  createPrisma: (databaseUrl) =>
    createPrismaClient({ datasources: { db: { url: databaseUrl } } }),
}

class UsageError extends Error {}

type ParsedCommand =
  | {
      readonly command: 'grant' | 'revoke'
      readonly envFile: string
      readonly confirmTarget: string | undefined
      readonly actorEmail: string
      readonly memberEmail: string
      readonly reason: string
      readonly dryRun: boolean
    }
  | {
      readonly command: 'list'
      readonly envFile: string
      readonly confirmTarget: string | undefined
      readonly actorEmail: string
    }

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new UsageError(`--${name} is required.`)
  }
  return value
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
  if (
    (command !== 'grant' && command !== 'revoke' && command !== 'list') ||
    positionals.length !== 1
  ) {
    throw new UsageError('The first argument must be grant, revoke or list.')
  }
  const envFile = required('env-file', values['env-file'])
  const actorEmail = required('actor-email', values['actor-email'])
  if (command === 'list') {
    for (const flag of ['member-email', 'reason', 'dry-run'] as const) {
      if (values[flag] !== undefined)
        throw new UsageError(`--${flag} does not apply to list.`)
    }
    return { command, envFile, confirmTarget: values['confirm-target'], actorEmail }
  }
  return {
    command,
    envFile,
    confirmTarget: values['confirm-target'],
    actorEmail,
    memberEmail: required('member-email', values['member-email']),
    reason: required('reason', values.reason),
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
      'member-email': { type: 'string' },
      reason: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
}

function loadDatabaseUrl(deps: ComplimentaryAccessCliDeps, envFile: string): string {
  let contents: string
  try {
    contents = deps.readEnvFile(envFile)
  } catch {
    throw new UsageError(`--env-file ${envFile} cannot be read.`)
  }
  const databaseUrl = readOperatorDatabaseUrl(contents)
  if (!databaseUrl) throw new UsageError(`--env-file ${envFile} has no DATABASE_URL.`)
  return databaseUrl
}

function serialize(outcome: object): string {
  return JSON.stringify(outcome, (_key, value: unknown) =>
    value instanceof Date ? value.toISOString() : value
  )
}

/** Runs one command and returns the process exit code. */
export async function runComplimentaryAccessCli(
  argv: readonly string[],
  deps: ComplimentaryAccessCliDeps = defaultDeps
): Promise<number> {
  let command: ParsedCommand
  let target: OperatorTarget
  let databaseUrl: string
  try {
    const parsed = parseCommand(argv)
    if (parsed === 'help') {
      deps.stdout(COMPLIMENTARY_ACCESS_USAGE)
      return EXIT_OK
    }
    command = parsed
    databaseUrl = loadDatabaseUrl(deps, command.envFile)
    target = resolveOperatorTarget(databaseUrl, command.confirmTarget)
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      deps.stderr(`access:complimentary: ${error.message}`)
      deps.stderr(COMPLIMENTARY_ACCESS_USAGE)
      return EXIT_USAGE
    }
    if (error instanceof OperatorTargetRefusal) {
      deps.stderr(`access:complimentary refused: ${error.message}`)
      return EXIT_REFUSED
    }
    throw error
  }

  const prisma = deps.createPrisma(databaseUrl)
  try {
    const operator = new ComplimentaryAccessOperatorService(prisma)
    const outcome =
      command.command === 'list'
        ? await operator.list(command.actorEmail)
        : await operator[command.command]({
            actorEmail: command.actorEmail,
            memberEmail: command.memberEmail,
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
    if (error instanceof ComplimentaryAccessRefusal) {
      deps.stderr(`access:complimentary refused (${error.code}): ${error.message}`)
      return EXIT_REFUSED
    }
    deps.stderr(
      `access:complimentary failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return EXIT_REFUSED
  } finally {
    await prisma.$disconnect()
  }
}
