import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

// U-SHARE-LOG-PRIVACY, node scan (Story 6.9). The share module may log closed codes only: no log
// call in its shipped Swift or Kotlin formats an activity type, a package or component name, a
// URI, URL or path, a digest, or an error object whose text can embed any of them.
const SHARE_MODULE = 'apps/mobile/modules/share-card-native-share'
const SOURCE = /\.(swift|kt|java)$/
// Test code, build output and the standalone unit-test project never ship in the app.
const SKIPPED = new Set([
  'Tests',
  'test',
  'androidTest',
  'unit-tests',
  'build',
  '.build',
  '.gradle',
  'node_modules',
])
const LOG_CALLS = [
  /\b(?:print|debugPrint|dump|NSLog|os_log|println)\s*\(/g,
  /\b(?:logger|log|Logger\([^)]*\))\s*\.\s*(?:trace|debug|info|notice|warning|error|critical|fault|log)\s*\(/g,
  /\bLog\.(?:v|d|i|w|e|wtf)\s*\(/g,
  /\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\(/g,
  /\bTimber\.\w+\s*\(/g,
]
const SENSITIVE = [
  ['activity_type', /activityType|activity_type|ActivityType|activity\s+type/i],
  ['package', /package/i],
  ['component', /component/i],
  ['uri', /\bur[il]\w*|\w*(?:Uri|URI|Url|URL)\b|absoluteString|\bpath\w*|\w*Path\b/],
  ['digest', /sha-?256|digest|expectedSha/i],
  [
    'error_text',
    /localizedDescription|\.message\b|stackTrace|printStackTrace|\\\(\s*(?:error|err|e|ex|exception|throwable)\s*\)|\$\{?\s*(?:error|err|e|ex|exception|throwable)\b/,
  ],
  ['throwable_argument', /,\s*(?:error|err|e|ex|exception|throwable|t|cause)\s*$/],
]

/** The text between a call's opening parenthesis and its matching close. */
function argumentsAt(source, open) {
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '(') depth++
    else if (source[index] === ')' && --depth === 0) return source.slice(open + 1, index)
  }
  return source.slice(open + 1)
}

/** `file:line:reason` for every log call in `source` that formats something sensitive. */
function sensitiveLogCalls(file, source) {
  const found = []
  for (const pattern of LOG_CALLS)
    for (const match of source.matchAll(pattern)) {
      const open = match.index + match[0].lastIndexOf('(')
      const args = argumentsAt(source, open).trim()
      const line = source.slice(0, match.index).split('\n').length
      for (const [reason, sensitive] of SENSITIVE)
        if (sensitive.test(args)) found.push(`${file}:${line}:${reason}`)
    }
  return found.sort()
}

function shippedSources(root) {
  const files = []
  const visit = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) visit(child)
      } else if (entry.isFile() && SOURCE.test(entry.name)) files.push(child)
    }
  }
  visit(SHARE_MODULE)
  return files.sort()
}

describe('U-SHARE-LOG-PRIVACY native log scan', () => {
  test('the scan flags every log call that formats an activity type, package, URI, digest or error', () => {
    const swift = [
      'print("share_card_native_share_failed")',
      'NSLog("activity %@", activityType.rawValue)',
      'os_log("done %{public}@", log: .default, type: .info, fileURL.path)',
      'logger.info("presented \\(url)")',
      'logger.error("failed: \\(error)")',
      'print(error.localizedDescription)',
      'print("sha \\(expectedSha256)")',
    ].join('\n')
    assert.deepEqual(sensitiveLogCalls('Module.swift', swift), [
      'Module.swift:2:activity_type',
      'Module.swift:3:uri',
      'Module.swift:4:uri',
      'Module.swift:5:error_text',
      'Module.swift:6:error_text',
      'Module.swift:7:digest',
    ])
    const kotlin = [
      'Log.w(TAG, "chooser_unavailable")',
      'Log.d(TAG, "chosen ${component.packageName}")',
      'Log.e(TAG, "start_failed", e)',
      'Log.i(TAG, "granted $contentUri")',
      'println("target " + chosen.packageName)',
      'Log.e(TAG, "start_failed: ${e.message}")',
    ].join('\n')
    assert.deepEqual(sensitiveLogCalls('Module.kt', kotlin), [
      'Module.kt:2:component',
      'Module.kt:2:package',
      'Module.kt:3:throwable_argument',
      'Module.kt:4:uri',
      'Module.kt:5:package',
      'Module.kt:6:error_text',
    ])
  })

  test('closed-code log calls and multi-line calls are read whole', () => {
    const source = [
      'Log.w(',
      '  TAG,',
      '  "share_card_share_${outcome.code}"',
      ')',
      'Log.w(',
      '  TAG,',
      '  "share ${intent.data}" + fileUri',
      ')',
    ].join('\n')
    assert.deepEqual(sensitiveLogCalls('Multi.kt', source), ['Multi.kt:5:uri'])
  })

  test('the walk targets the share module and skips tests and build output', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-log-scan-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const write = (relative, text) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), text)
    }
    write(`${SHARE_MODULE}/ios/ShareCardNativeShareModule.swift`, 'print(fileURL)\n')
    write(`${SHARE_MODULE}/android/src/main/java/x/Module.kt`, 'Log.d(TAG, "ok")\n')
    write(`${SHARE_MODULE}/ios/Tests/ShareCardShareFileTests.swift`, 'print(fileURL)\n')
    write(`${SHARE_MODULE}/android/src/androidTest/java/x/T.kt`, 'Log.d(TAG, uri)\n')
    write(`${SHARE_MODULE}/android/unit-tests/build/x/Gen.kt`, 'Log.d(TAG, uri)\n')
    write(`${SHARE_MODULE}/ios/.build/out/Gen.swift`, 'print(url)\n')
    assert.deepEqual(shippedSources(root), [
      `${SHARE_MODULE}/android/src/main/java/x/Module.kt`,
      `${SHARE_MODULE}/ios/ShareCardNativeShareModule.swift`,
    ])
  })

  // Passes with no native sources yet; it still fails if the module folder moves away.
  test('no shipped Swift or Kotlin log call in the share module formats sensitive values', () => {
    const root = path.resolve(import.meta.dirname, '../..')
    assert.ok(fs.existsSync(path.join(root, SHARE_MODULE)), SHARE_MODULE)
    const found = shippedSources(root).flatMap((file) =>
      sensitiveLogCalls(file, fs.readFileSync(path.join(root, file), 'utf8'))
    )
    assert.deepEqual(found, [])
  })
})
