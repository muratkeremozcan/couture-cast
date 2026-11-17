import fs from 'node:fs'
import path from 'node:path'

// Why the owned auth proxy (auth.mjs) failed to start, in a form the job log may print. Its own
// log stays private, so web.mjs reads this record to name the failure instead of a bare status.

export const AUTH_STARTUP_FAILURE_FILE = 'auth-startup-failure.json'

/**
 * The error's name, code, call and address only. A message can quote what the call failed on:
 * a JSON parse error quotes the owned env file, which holds the service-role key.
 * @param {unknown} error
 */
export function authStartupFailure(error) {
  const field = (key, type) => {
    const value = /** @type {Record<string, unknown>} */ (error ?? {})[key]
    return typeof value === type ? value : null
  }
  return {
    name: error instanceof Error ? error.name : null,
    code: field('code', 'string'),
    syscall: field('syscall', 'string'),
    address: field('address', 'string'),
    port: field('port', 'number'),
  }
}

/** @param {string} directory @param {unknown} error */
export function recordAuthStartupFailure(directory, error) {
  fs.writeFileSync(
    path.join(directory, AUTH_STARTUP_FAILURE_FILE),
    `${JSON.stringify(authStartupFailure(error), null, 2)}\n`,
    { mode: 0o600 }
  )
}

/** One line for an error message, or null when there is no record. @param {string} directory */
export function describeAuthStartupFailure(directory) {
  let record
  try {
    record = JSON.parse(
      fs.readFileSync(path.join(directory, AUTH_STARTUP_FAILURE_FILE), 'utf8')
    )
  } catch {
    return null
  }
  const where = [record.syscall, [record.address, record.port].filter(Boolean).join(':')]
    .filter(Boolean)
    .join(' ')
  return `its startup failed with ${record.code ?? record.name ?? 'an unnamed error'}${where ? ` on ${where}` : ''}`
}
