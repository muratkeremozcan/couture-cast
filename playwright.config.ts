import { config as dotenvConfig } from 'dotenv'
import path from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'
import localConfig from './playwright/config/local.config'
import localRestrictedConfig, {
  isRestrictedEvidenceRun,
} from './playwright/config/local-restricted.config'
import previewConfig from './playwright/config/preview.config'
import prodConfig from './playwright/config/prod.config'

dotenvConfig({
  path: path.resolve(__dirname, '.env'),
})

const envConfigMap: Record<string, PlaywrightTestConfig> = {
  local: localConfig,
  preview: previewConfig,
  prod: prodConfig,
}

const desiredEnv = (process.env.TEST_ENV ?? 'local').toLowerCase()

if (!envConfigMap[desiredEnv]) {
  console.error(`No Playwright configuration found for TEST_ENV="${desiredEnv}"`)
  console.error(
    'Available environments:',
    Object.keys(envConfigMap)
      .map((env) => `\n- ${env}`)
      .join('')
  )
  process.exit(1)
}

// Restricted mode is a second axis on top of TEST_ENV. The value has to stay
// `local`: global teardown's db:reset is gated on that exact string, and it is
// what deletes the rows a real-model run leaves behind.
const restrictedRun = isRestrictedEvidenceRun()

if (restrictedRun) {
  if (desiredEnv !== 'local') {
    console.error(
      `Restricted evidence runs require TEST_ENV="local", got "${desiredEnv}".`
    )
    console.error('Unset COMMUNITY_SCREENING_EVIDENCE_MODE to run that environment.')
    process.exit(1)
  }

  // Two CLI paths outrank whatever a config file asks for: `--trace <mode>`
  // overwrites `use.trace`, and UI mode records a live trace of its own with
  // screenshots and snapshots in it. Refuse both.
  /*
   * Both spellings of every flag, because commander accepts `--opt value` and
   * `--opt=value` alike and matching only the bare form leaves the equals form
   * as an open bypass on exactly the run whose purpose is that uploaded bytes
   * never reach disk. `--reporter html` re-adds the attachment-copying bundle
   * and `--output` redirects artifacts somewhere unmanaged, so both join
   * `--trace` and UI mode rather than only the obvious one.
   */
  const forbidden = ['--trace', '--reporter', '--output', '--ui']
  const captureFlags = process.argv.filter((arg) =>
    forbidden.some(
      (flag) => arg === flag || arg.startsWith(`${flag}=`) || arg.startsWith('--ui')
    )
  )
  if (captureFlags.length > 0) {
    console.error(`Restricted evidence runs cannot use ${captureFlags.join(', ')}.`)
    console.error('These re-enable the capture that Story 6.2 AC 9 requires to stay off.')
    process.exit(1)
  }
}

const config = restrictedRun ? localRestrictedConfig : envConfigMap[desiredEnv]

export default config
