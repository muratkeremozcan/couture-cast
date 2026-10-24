/**
 * The run's record of the Auth users it creates: `<run dir>/created-identities.json`.
 *
 * Every write is write-ahead. `recordPendingIdentity` appends a row marked
 * `pending: true` (an address, no Auth id yet) BEFORE the Auth Admin call that
 * creates the user, and `recordCreatedIdentity` replaces that row with the full
 * account once the call returns. A worker killed between the two leaves the pending
 * row behind, and cleanup resolves the Auth id from the address, so no user the run
 * created can exist without a row naming it.
 *
 * Each write is a synchronous read, change and atomic rename (tmp file in the same
 * directory), so a reader never sees a torn file and a writer never drops a row
 * another write appended before it read.
 */
import fs from 'node:fs'
import path from 'node:path'

export const IDENTITIES_FILE = 'created-identities.json'

/**
 * The recorded rows, or none when the run has recorded nothing yet.
 *
 * @param {string} directory
 * @returns {Record<string, unknown>[]}
 */
export function readIdentities(directory) {
  const file = path.join(directory, IDENTITIES_FILE)
  if (!fs.existsSync(file)) return []
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error(`${IDENTITIES_FILE} is not a list.`)
  return rows
}

/**
 * @param {string} directory
 * @param {readonly unknown[]} rows
 */
export function writeIdentities(directory, rows) {
  const file = path.join(directory, IDENTITIES_FILE)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * Appends the row for an Auth user about to be created. It carries everything the
 * full account will, except the Auth id.
 *
 * @param {string} directory
 * @param {{ email: string } & Record<string, unknown>} row
 */
export function recordPendingIdentity(directory, row) {
  const pending = { ...row, pending: true }
  delete pending.authUserId
  writeIdentities(directory, [...readIdentities(directory), pending])
}

/**
 * Replaces the pending row for `account.email` with the created account, or
 * appends it when no pending row exists.
 *
 * @param {string} directory
 * @param {{ email: string; authUserId: string } & Record<string, unknown>} account
 */
export function recordCreatedIdentity(directory, account) {
  const rows = readIdentities(directory)
  const index = rows.findIndex(
    (row) => row.pending === true && row.email === account.email
  )
  if (index === -1) rows.push(account)
  else rows[index] = account
  writeIdentities(directory, rows)
}
