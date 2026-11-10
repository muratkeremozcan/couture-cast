// Story 6.14: owner operator command targeting, shared by the sponsorship (6.7b) and
// complimentary access (6.14) commands. Moved here unchanged from community-sponsorship.cli.ts.
import { parseEnv } from 'node:util'

/**
 * TARGETING. `--env-file` is required and is the only source of `DATABASE_URL`; the ambient
 * environment is ignored, so a shell that happens to export a production URL cannot be written
 * to by accident. A loopback host runs as is. Any other host also needs `--confirm-target
 * <project ref>` equal to the ref parsed from the URL, and a remote URL whose ref cannot be
 * parsed is refused.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type OperatorTarget =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly ref: string }

export class OperatorTargetRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperatorTargetRefusal'
  }
}

/**
 * Decides whether this command may write to `databaseUrl`. Node's `URL`
 * reports an IPv6 loopback host as `[::1]`, so brackets are removed before
 * the loopback check.
 */
export function resolveOperatorTarget(
  databaseUrl: string,
  confirmTarget: string | undefined
): OperatorTarget {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new OperatorTargetRefusal('DATABASE_URL in --env-file is not a valid URL.')
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (LOOPBACK_HOSTS.has(host)) return { kind: 'local' }

  const ref =
    /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1] ??
    /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1]
  if (!ref) {
    throw new OperatorTargetRefusal(
      'DATABASE_URL points at a remote host whose project ref cannot be parsed; refusing.'
    )
  }
  if (confirmTarget !== ref) {
    throw new OperatorTargetRefusal(
      `DATABASE_URL targets remote project ${ref}; pass --confirm-target ${ref} to write to it.`
    )
  }
  return { kind: 'remote', ref }
}

/** Reads `DATABASE_URL` from the env file alone; null when the file has none. */
export function readOperatorDatabaseUrl(contents: string): string | null {
  const value: unknown = new Map(Object.entries(parseEnv(contents))).get('DATABASE_URL')
  const databaseUrl = typeof value === 'string' ? value.trim() : ''
  return databaseUrl || null
}
