import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { shareCardAuditLocales } from '../lib/share-card-audit-report.mjs'
import { bridgeUnitDiagnostics } from '../lib/story68-bridge-unit-result.mjs'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const reportFile = path.join(directory, 'bridge-unit-private.json')
fs.rmSync(reportFile, { force: true })
const logFile = path.join(directory, 'bridge-unit-private.log')
const log = fs.openSync(logFile, 'w', 0o600)
const result = spawnSync(
  process.execPath,
  [
    path.resolve('node_modules/vitest/vitest.mjs'),
    'run',
    'components/share-card-composer.test.tsx',
    'src/lib/share-card-focus.spec.ts',
    '--reporter=json',
    `--outputFile=${reportFile}`,
  ],
  { cwd: path.resolve('apps/mobile'), stdio: ['ignore', log, log] }
)
fs.closeSync(log)
let report = null
let invalidReport = false
try {
  if (fs.existsSync(reportFile)) report = JSON.parse(fs.readFileSync(reportFile))
} catch {
  invalidReport = true
}
const tests = (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
const states = [
  'saved',
  'storage',
  'offline',
  'permissionDenied',
  'permissionPermanent',
  'limited',
  'finishingSave',
  'nativeSaveUnavailable',
]
// These are the titles Vitest 5 renders for the spec's test.each templates. Vitest 5
// prints a string $value without quotes; Vitest 4 rendered `$locale` as 'en-US'.
const cases = shareCardAuditLocales
  .flatMap((locale) => [
    ...states.map((state) => ({
      locale,
      state,
      name: `U-A11Y: ${locale} ${state} posts its exact localized announcement with the correct queue`,
    })),
    {
      locale,
      state: 'preparing',
      name: `U-A11Y-PREPARING: ${locale} posts its exact localized preparation announcement and title target`,
    },
  ])
  .map(({ locale, state, name }) => ({
    locale,
    state,
    passed: tests.some((test) => test.title === name && test.status === 'passed'),
  }))
const passed =
  result.status === 0 && report?.success === true && cases.every((row) => row.passed)
const runner = bridgeUnitDiagnostics({
  result,
  report,
  invalidReport,
  log: fs.readFileSync(logFile, 'utf8'),
  matchedCases: cases.filter((row) => row.passed).length,
  requiredCases: cases.length,
})
fs.writeFileSync(
  path.join(directory, 'accessibility-bridge.json'),
  JSON.stringify(
    {
      method:
        'React Native posted accessibility announcement and intended focus bridge unit assertions',
      passed,
      cases,
      runner,
    },
    null,
    2
  ) + '\n',
  { mode: 0o600 }
)
if (!passed) {
  console.error('Native accessibility bridge runner:', JSON.stringify(runner))
  throw new Error('native_accessibility_bridge_assertions_failed')
}
console.log(
  `Native accessibility bridge passed ${cases.length} exact localized state assertions.`
)
