// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// iOS 26.5 canary shard 3 failed ShareCardAccessibilityUITests on "Potentially inaccessible
// text" while preparing and left no picture of the screen. audit(_:) now attaches the screen to
// every issue it refuses, as `audit-failure-<state>`, and a failed audit run exports those
// attachments from its xcresult into the harness directory as `audit-failure-<state>.png`.
// scripts/e2e-share-card/public-evidence.mjs publishes only these fixed names, after the
// secret scan below.
import nodeFs from 'node:fs'
import path from 'node:path'

/** Every state ShareCardAccessibilityUITests.audit(_:) is called with. */
export const AUDIT_STATES = Object.freeze([
  'denied',
  'limited',
  'offline',
  'open',
  'pending',
  'permanent-denied',
  'preparing',
  'saved',
  'storage-failure',
  'unavailable',
])
const STATE = AUDIT_STATES.join('|')
/** The published name of each state's screen. */
export const AUDIT_SCREEN_FILE = new RegExp(`^audit-failure-(${STATE})\\.png$`)
/** xcresulttool names an attachment `<name>_<index>_<UUID>.<extension>`. */
const SUGGESTED_NAME = new RegExp(
  `^audit-failure-(${STATE})_\\d+_[0-9A-Fa-f-]{36}\\.png$`
)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// The pattern public-evidence.mjs refuses in its JSON, read over the image's bytes, where
// metadata text would show.
export const PRIVATE_TEXT =
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|access_token|refresh_token|service_role|@example\.test|@cc68\.test/i

/** Throws unless `bytes` is a PNG with no private text in it. */
export function assertPublicAuditScreen(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error('invalid_audit_failure_screen')
  if (PRIVATE_TEXT.test(bytes.toString('latin1')))
    throw new Error('private_data_in_public_evidence')
}

/** Removes the screens an earlier audit run left, so a reused runtime cannot republish them. */
export function clearAuditScreens(directory, fs = nodeFs) {
  for (const name of fs.readdirSync(directory))
    if (AUDIT_SCREEN_FILE.test(name))
      fs.rmSync(path.join(directory, name), { force: true })
}

/**
 * Exports the `audit-failure-<state>` screenshots of the failed audit run `result` into
 * `directory` as `audit-failure-<state>.png`, the earliest one of each state, and returns the
 * states written. `run(binary, args)` runs one command and throws on a failure. The export goes
 * to a private folder beside them, removed afterwards; anything that is not such a PNG stays
 * there.
 */
export function exportAuditScreens({ result, directory, run, fs = nodeFs }) {
  const exported = path.join(directory, `.audit-attachments-${process.pid}`)
  fs.rmSync(exported, { recursive: true, force: true })
  fs.mkdirSync(exported, { recursive: true })
  try {
    run('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      result,
      '--output-path',
      exported,
      '--filter',
      'audit-failure-*',
    ])
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exported, 'manifest.json'), 'utf8')
    )
    const earliest = new Map()
    for (const test of Array.isArray(manifest) ? manifest : [])
      for (const attachment of test?.attachments ?? []) {
        const state = SUGGESTED_NAME.exec(
          attachment?.suggestedHumanReadableName ?? ''
        )?.[1]
        const file = attachment?.exportedFileName
        if (!state || typeof file !== 'string' || path.basename(file) !== file) continue
        const at = Number(attachment.timestamp ?? 0)
        if (!earliest.has(state) || at < earliest.get(state).at)
          earliest.set(state, { at, file })
      }
    const written = []
    for (const [state, { file }] of [...earliest].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const bytes = fs.readFileSync(path.join(exported, file))
      assertPublicAuditScreen(bytes)
      fs.writeFileSync(path.join(directory, `audit-failure-${state}.png`), bytes)
      written.push(state)
    }
    return written
  } finally {
    fs.rmSync(exported, { recursive: true, force: true })
  }
}
