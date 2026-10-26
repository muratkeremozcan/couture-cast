import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { shareCardAuditLocales } from '../lib/share-card-audit-report.mjs'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const reportFile = path.join(directory, 'bridge-unit-private.json')
const log = fs.openSync(path.join(directory, 'bridge-unit-private.log'), 'a', 0o600)
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
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : {}
const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
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
const cases = shareCardAuditLocales
  .flatMap((locale) => [
    ...states.map((state) => ({
      locale,
      state,
      name: `U-A11Y: '${locale}' '${state}' posts its exact localized announcement with the correct queue`,
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
  result.status === 0 && report.success === true && cases.every((row) => row.passed)
fs.writeFileSync(
  path.join(directory, 'accessibility-bridge.json'),
  JSON.stringify(
    {
      method:
        'React Native posted accessibility announcement and intended focus bridge unit assertions',
      passed,
      cases,
    },
    null,
    2
  ) + '\n',
  { mode: 0o600 }
)
if (!passed) throw new Error('native_accessibility_bridge_assertions_failed')
console.log(
  `Native accessibility bridge passed ${cases.length} exact localized state assertions.`
)
