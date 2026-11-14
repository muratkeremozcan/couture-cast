// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('../run-story68-native.mjs', import.meta.url),
  'utf8'
)
const body = (name) => {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, name)
  return source.slice(start, source.indexOf('\n}\n', start))
}

test('hierarchy reads go through the pinned iOS driver the flows use', () => {
  const reader = body('hierarchyOutput')
  assert.match(reader, /\.\.\.iosDriverGlobalArgs\(platform\)/)
  assert.match(reader, /iosDriverTestArgs\(\{ platform, directory, device \}\)/)
  // Global options come before the subcommand and the reinstall option after it, as for `test`.
  assert.ok(reader.indexOf('iosDriverGlobalArgs') < reader.indexOf("'hierarchy'"))
  assert.ok(reader.indexOf("'hierarchy'") < reader.indexOf('iosDriverTestArgs'))
})

test('the approved-preview reads share that reader', () => {
  assert.match(body('captureApproved'), /hierarchyOutput\(\)/)
  assert.match(body('previewDigest'), /hierarchyOutput\(\)/)
  assert.match(body('composerLayout'), /readComposerLayout\(hierarchyOutput\(\)\)/)
  assert.match(source, /JSON\.parse\(hierarchyOutput\(\)\)/)
})

test('only the Settings breadcrumb read keeps a bare hierarchy call', () => {
  const bare = [
    ...source.matchAll(/run\(maestroBinary, \['--device', device, 'hierarchy'\]\)/g),
  ]
  assert.equal(bare.length, 1)
  assert.ok(source.slice(bare[0].index - 120, bare[0].index).includes('breadcrumbIn'))
})

// Antigravity audit-diag P2: the audit failure screen is read through the owned driver after the
// stale one is stopped, and never replaces the audit failure.
test('the audit failure screen stops the owned driver, then reads through it, inside a guard', () => {
  const failure = source.slice(
    source.indexOf('iosAuditFailure: {'),
    source.indexOf("throw new Error('ios_accessibility_audit_failed')")
  )
  const stop = failure.indexOf(
    'recordIosDriverFlow({ platform, directory, device, ok: false })'
  )
  const read = failure.indexOf('hierarchyOutput()')
  const guard = failure.indexOf('try {')
  assert.ok(guard >= 0 && stop > guard && read > stop, failure)
  assert.match(
    failure,
    /\} catch \{\n\s+console\.log\(JSON\.stringify\(\{ iosAuditFailureScreen: 'unavailable' \}\)\)/
  )
})
