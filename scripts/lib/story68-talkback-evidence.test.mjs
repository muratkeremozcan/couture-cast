// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  bundleBuilds,
  focusLatencies,
  talkBackVersion,
  talkbackEvidence,
} from './story68-talkback-evidence.mjs'

test('bundle builds are counted from the Metro log and only the stage window is reported', () => {
  const before = bundleBuilds('Android Bundled 4200ms entry.js (2000 modules)\nnoise\n')
  const after = bundleBuilds(
    'Android Bundled 4200ms entry.js\nAndroid Bundled 13800ms node_modules/expo-media-library/x.js\nAndroid Bundled 90ms entry.js\n'
  )
  const evidence = talkbackEvidence({
    version: '16.1.0',
    enableMs: 5123,
    instrumentMs: 41999,
    bundlesBefore: before,
    bundlesAfter: after,
  })
  assert.deepEqual(evidence, {
    version: 1,
    talkBackVersion: '16.1.0',
    enableSeconds: 5.1,
    instrumentSeconds: 42,
    bundleBuildsDuringStage: 2,
    bundleMsDuringStage: [13800, 90],
    focusWaits: [],
  })
})

test('the TalkBack version comes from dumpsys and nothing else leaks in', () => {
  assert.equal(
    talkBackVersion('Packages:\n  versionCode=1 versionName=16.1.0.123\n'),
    '16.1.0.123'
  )
  for (const text of ['', undefined, 'versionName=<script>', 'no version here'])
    assert.equal(talkBackVersion(text), null)
})

test('missing inputs give null fields instead of invented numbers', () => {
  assert.deepEqual(talkbackEvidence({}), {
    version: 1,
    talkBackVersion: null,
    enableSeconds: null,
    instrumentSeconds: null,
    bundleBuildsDuringStage: 0,
    bundleMsDuringStage: [],
    focusWaits: [],
  })
  assert.deepEqual(bundleBuilds(undefined), [])
})

test('the harness prints the evidence before it decides pass or fail', () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  const evidence = source.indexOf('talkbackEvidence: talkbackEvidence(')
  const verdict = source.indexOf("throw new Error('actual_talkback_composer_failed')")
  const instrument = source.indexOf(
    "'expo.modules.accessibilityfocus.ShareCardComposerTalkBackTest'"
  )
  assert.ok(instrument > 0 && instrument < evidence && evidence < verdict)
})

test('focus latencies are parsed from closed lines only and carried into the evidence', () => {
  const output = [
    'INSTRUMENTATION_STATUS: stream=',
    'CC68_FOCUS_LATENCY|TalkBack restored to opener|812|ok',
    'CC68_FOCUS_LATENCY|TalkBack focus on Save after saving|5000|timeout',
    'CC68_FOCUS_LATENCY|bad<name>|1|ok',
    'CC68_FOCUS_LATENCY|Save initially focused|12345678|ok',
    'CC68_FOCUS_LATENCY|Save initially focused|120|maybe',
    'text before CC68_FOCUS_LATENCY|Injected|1|ok',
  ].join('\n')
  const waits = focusLatencies(output)
  assert.deepEqual(waits, [
    { wait: 'TalkBack restored to opener', ms: 812, outcome: 'ok' },
    { wait: 'TalkBack focus on Save after saving', ms: 5000, outcome: 'timeout' },
  ])
  assert.deepEqual(talkbackEvidence({ focusWaits: waits }).focusWaits, waits)
  assert.deepEqual(focusLatencies(undefined), [])
})

test('the harness feeds the parsed focus latencies into the evidence it prints', () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  assert.match(source, /focusWaits: focusLatencies\(output\)/)
})
