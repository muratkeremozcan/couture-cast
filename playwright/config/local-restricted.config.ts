import path from 'node:path'
import merge from 'lodash.merge'
import { defineConfig } from '@playwright/test'
import localConfig from './local.config'

// Story 6.2 AC 9. The restricted journey uploads real image bytes through the
// real screening model, so nothing that could persist a frame of one survives:
// no trace, no screenshot, no video, and no html report, whose output directory
// copies test attachments into a self-contained shareable bundle. Failures read
// from the list reporter's stack alone.

export const RESTRICTED_EVIDENCE_MODE = 'real-model'

// Keyed on the same variable the E2E launcher reads to pick the real screener,
// so the real model and the disabled captures cannot be selected apart.
//
// File logging is silenced by DISABLE_FILE_LOGS in the npm script rather than
// here. `local.config.ts` calls `log.configure` at import time and this module
// imports it at the top, so by the time any statement here runs the logger is
// already armed.
export function isRestrictedEvidenceRun() {
  return (
    process.env.COMMUNITY_SCREENING_EVIDENCE_MODE?.trim().toLowerCase() ===
    RESTRICTED_EVIDENCE_MODE
  )
}

// Inside the git-ignored `playwright/artifacts`, under its own subdirectory so
// anything a restricted test writes stays identifiable and purgeable.
const outputDir = path.resolve(__dirname, '..', 'artifacts', 'restricted')

export default defineConfig({
  ...merge({}, localConfig, {
    use: {
      trace: 'off',
      screenshot: 'off',
      video: 'off',
    },
    outputDir,
    webServer: {
      env: {
        COMMUNITY_SCREENING_EVIDENCE_MODE: RESTRICTED_EVIDENCE_MODE,
      },
    },
  }),
  // lodash.merge walks arrays index by index, so overriding this inside the
  // merge above would leave base's html entry sitting at index 1.
  reporter: [['list']],
})
