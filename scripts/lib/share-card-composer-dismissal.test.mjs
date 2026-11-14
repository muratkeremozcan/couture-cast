import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

// React Native dismisses the share-card composer after the Cancel tap returns. Nightly iOS native
// runs 43385098696, 43438780572 and 43494979286 failed when a guarded `if cancel.exists
// { cancel.tap() }` saw the leaving sheet and tapped it after it was gone. These checks keep every
// XCUITest close on the shared helper that waits the dismissal out.
const tests = 'apps/mobile/native-tests'
const read = (name) => fs.readFileSync(path.join(tests, name), 'utf8')
const helper = read('ShareCardComposerDismissal.swift')
const callers = [
  'ShareCardAccessibilityUITests.swift',
  'ShareCardShareSheetUITests.swift',
]

describe('share-card composer dismissal in the iOS XCUITests', () => {
  test('no XCUITest taps the composer Cancel outside the shared helper', () => {
    for (const name of fs.readdirSync(tests).filter((file) => file.endsWith('.swift'))) {
      if (name === 'ShareCardComposerDismissal.swift') continue
      const source = read(name)
      assert.doesNotMatch(
        source,
        /element\("share-card-cancel"\)\.tap\(\)/,
        `${name} taps share-card-cancel directly`
      )
      assert.doesNotMatch(
        source,
        /\.exists \{ element\("share-card-cancel"\)/,
        `${name} guards a Cancel tap with a bare exists check`
      )
    }
    for (const name of callers)
      assert.match(read(name), /closeShareCard(IfOpen)?\(app\)/, name)
  })

  test('a close taps Cancel once and fails unless the composer is gone', () => {
    const close = /func closeShareCard\([\s\S]*?\n}/.exec(helper)[0]
    assert.match(close, /cancel\.waitForExistence\(timeout: 20\)/)
    assert.equal([...close.matchAll(/\.tap\(\)/g)].length, 1)
    assert.match(
      close,
      /cancel\.tap\(\)\n\s+XCTAssertTrue\(shareCardGone\(cancel, within: shareCardDismissalTimeout\)[^\n]*\n\s+XCTAssertTrue\(shareCardGone\(title, within: shareCardDismissalTimeout\)/
    )
    assert.match(helper, /shareCardDismissalTimeout: TimeInterval = 10\n/)
    const gone = /func shareCardGone\([\s\S]*?\n}/.exec(helper)[0]
    assert.match(gone, /NSPredicate\(format: "exists == false"\)/)
    assert.match(
      gone,
      /XCTWaiter\.wait\(for: \[gone\], timeout: timeout\) == \.completed/
    )
  })

  test('a guarded close lets a leaving composer go and taps only one that stays', () => {
    const guarded = /func closeShareCardIfOpen\([\s\S]*?\n}/.exec(helper)[0]
    assert.match(
      guarded,
      /guard cancel\.exists, !shareCardGone\(cancel, within: shareCardLeavingWindow\) else \{ return \}\n\s+closeShareCard\(app, file: file, line: line\)/
    )
    assert.doesNotMatch(guarded, /\.tap\(\)/)
    assert.match(helper, /shareCardLeavingWindow: TimeInterval = 2\n/)
  })

  test('both XCUITest targets compile the shared helper', () => {
    const project = read('project.yml')
    assert.match(project, /^ {6}- ShareCardComposerDismissal\.swift$/m)
    assert.match(
      fs.readFileSync('scripts/run-story68-native.mjs', 'utf8'),
      /'ShareCardHeaderQuery\.swift',\n\s+'ShareCardComposerDismissal\.swift',\n\s+\]\)\n\s+fs\.copyFileSync/
    )
    const shareSheet = fs.readFileSync('scripts/lib/story69-share-sheet.mjs', 'utf8')
    const filter = new RegExp(
      /\.filter\(\(name\) => \/(.+)\/\.test\(name\)\)/.exec(shareSheet)[1]
    )
    const copied = fs
      .readdirSync(tests)
      .filter((name) => filter.test(name))
      .sort()
    assert.deepEqual(copied, [
      'ShareCardComposerDismissal.swift',
      'ShareCardShareSheetUITests.swift',
    ])
  })

  test('a missing outfit opener prints what the screen showed before the test fails', () => {
    const source = read('ShareCardAccessibilityUITests.swift')
    assert.match(
      source,
      /let found = opener\.waitForExistence\(timeout: 20\)\n\s+if !found \{ shareCardAuditContextLines\("opener-missing", app\)\.forEach \{ print\(\$0\) \} \}\n\s+XCTAssertTrue\(found, "outfit share-card opener present"\)/
    )
  })
})
