import type { TestProject } from 'vitest/node'
import {
  enablePrivacyGuard,
  restorePrivacyVersion,
} from './helpers/privacy-capability.js'

/**
 * Runs once, before any test file, against the shared integration database that
 * vitest.config.ts pins into `test.env`. Locally and in CI alike the tier runs with the
 * privacy guard on; isolated databases turn it on after their own migrations.
 *
 * The teardown puts the version back, so a database other suites share (the
 * `packages/db` RLS suites run at the migrated default) is left as the tier found it.
 */
export default async function setup(project: TestProject) {
  const url = project.config.env.INTEGRATION_TEST_DATABASE_URL
  if (!url) return
  const previous = await enablePrivacyGuard(url)
  if (previous === null) {
    console.info('Integration database unavailable; its suites skip themselves.')
    return
  }
  return async () => {
    await restorePrivacyVersion(url, previous)
  }
}
