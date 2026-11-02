import fs from 'node:fs'
import path from 'node:path'

/**
 * Sign-in code requests the owned auth proxy saw while one flow ran. A failed sign-in flow
 * (runs 41332254336 and 41341524306) could not tell a Send press that never reached the app from
 * a request that reached the proxy and failed or stalled; these rows tell them apart. Closed
 * values only: the proxy's mode name, the HTTP status and the milliseconds since the flow began.
 */
export const AUTH_OTP_PATH = '/auth/v1/otp'
export const AUTH_OTP_MODES = Object.freeze([
  'owned-admin-generateLink',
  'real-local-auth',
  'refused-unrecorded-email',
  'harness-error',
])
export const AUTH_OTP_ROW_LIMIT = 8
const integer = (value) => Number.isSafeInteger(value) && value >= 0

export function authOtpRows({ directory, since, read = fs.readFileSync }) {
  if (!integer(since)) return []
  let observations
  try {
    observations = JSON.parse(
      read(path.join(directory, 'auth-observations.json'), 'utf8')
    )
  } catch {
    return []
  }
  if (!Array.isArray(observations)) return []
  return observations
    .filter(
      (row) =>
        row?.path === AUTH_OTP_PATH &&
        integer(row.at) &&
        row.at >= since &&
        AUTH_OTP_MODES.includes(row.mode) &&
        Number.isInteger(row.status) &&
        row.status >= 100 &&
        row.status <= 599
    )
    .map((row) => ({ mode: row.mode, status: row.status, afterMs: row.at - since }))
    .slice(-AUTH_OTP_ROW_LIMIT)
}

export function validAuthOtpRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.length <= AUTH_OTP_ROW_LIMIT &&
    rows.every(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        Object.keys(row).sort().join() === 'afterMs,mode,status' &&
        AUTH_OTP_MODES.includes(row.mode) &&
        Number.isInteger(row.status) &&
        row.status >= 100 &&
        row.status <= 599 &&
        integer(row.afterMs)
    )
  )
}
