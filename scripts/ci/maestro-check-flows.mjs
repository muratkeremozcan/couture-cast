/**
 * Runs `maestro check-syntax` over the flows this journey added or restructured. The Maestro CLI
 * is installed after the node test gate runs, so a test that needed it would have to skip, and a
 * skipped test fails the gate. The iOS build job runs this once the pinned CLI is installed.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MAESTRO_BIN } from '../maestro-version.mjs'

export const CHECKED_FLOWS = Object.freeze([
  'maestro/story65/open-app.yaml',
  'maestro/story65/open-notification-settings.yaml',
  'maestro/story65/open-signin.yaml',
  'maestro/story65/session-signout.yaml',
  'maestro/story65/set-locale.yaml',
  'maestro/story65/signin-verify.yaml',
  'maestro/story65/wait-notification-settings.yaml',
  'maestro/story67/teaser-signout.yaml',
  'maestro/story68/position-outfit-open.yaml',
  'maestro/story68/settings.yaml',
  'maestro/story68/wait-os-settings-ios.yaml',
  'maestro/story68/open-outfit.yaml',
  'maestro/story68/open-post.yaml',
  'maestro/story68/preparing-cancel.yaml',
  'maestro/story68/expo-go-open.yaml',
  'maestro/story68/expo-go-unavailable.yaml',
  'maestro/story68/rapid-ready-outfit.yaml',
  'maestro/story68/rapid-watermark-held.yaml',
  'maestro/story68/toggle-once.yaml',
  'maestro/story68/watermark.yaml',
  'maestro/story68/tap-save.yaml',
  'maestro/story68/permanent.yaml',
  'maestro/story68/save.yaml',
  'maestro/story68/denied.yaml',
  'maestro/story68/failure.yaml',
  'maestro/story68/precommit-cancel.yaml',
  'maestro/story68/pending.yaml',
  'maestro/story68/release-watermark-off.yaml',
  'maestro/story68/prefs-failed.yaml',
  'maestro/story68/signout.yaml',
  'maestro/story68/community-draft-background-ios.yaml',
  'maestro/story68/tap-share.yaml',
  'maestro/story68/share-completed.yaml',
  'maestro/story68/share-chosen.yaml',
  'maestro/story68/share-closed.yaml',
  'maestro/story68/share-not-confirmed.yaml',
  'maestro/story68/share-failed.yaml',
  'maestro/story68/share-unavailable.yaml',
  'maestro/story68/share-other.yaml',
  'maestro/story68/share-sheet.yaml',
])

// The pinned install on CI, the PATH binary on a developer machine.
const defaultBinary = () => (fs.existsSync(MAESTRO_BIN) ? MAESTRO_BIN : 'maestro')

export function checkFlows(flows = CHECKED_FLOWS, binary = defaultBinary()) {
  const failures = []
  for (const flow of flows) {
    const result = spawnSync(binary, ['check-syntax', flow], {
      encoding: 'utf8',
      env: { ...process.env, MAESTRO_APP_ID: 'app' },
    })
    if (result.status !== 0)
      failures.push(
        `${flow}: ${`${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`.trim().slice(0, 300)}`
      )
  }
  return failures
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = checkFlows()
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  } else console.log(`Maestro accepted ${CHECKED_FLOWS.length} flows.`)
}
