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
  assert.match(source, /JSON\.parse\(hierarchyOutput\(\)\)/)
})

test('only the Settings breadcrumb read and the audit diagnostic keep a bare hierarchy call', () => {
  const bare = [
    ...source.matchAll(/run\(maestroBinary, \['--device', device, 'hierarchy'\]\)/g),
  ]
  assert.equal(bare.length, 2)
  const context = bare.map((match) => source.slice(match.index - 120, match.index))
  assert.ok(context.some((text) => text.includes('breadcrumbIn')))
  assert.ok(context.some((text) => text.includes('const hierarchy =')))
})
