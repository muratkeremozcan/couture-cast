// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA-06 (story 6.15 D5 row 1): Story 6.8 reverted an app-wide AppText font-scale repair that
// blanked text in Release. With React Native's own fix, app code needs no font-scale wrapper. The
// only reads allowed are the share-card composer's layout rules, each with its reason:
// - `feedbackSlotHeight` and `ComposerFeedback`: reserve the feedback slot at the current scale so Save and Share stay
//   put when feedback appears;
// - `actionRowTier` and `useActionColumns`: choose halves, content or stacked buttons from labels
//   measured at the current scale.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/mobile'
)
const SOURCE_DIRECTORIES = ['app', 'src', 'components']
const BANNED = /\b(getFontScale|maxFontSizeMultiplier|allowFontScaling)\b/
const FONT_SCALE = /\bfontScale\b/
const ALLOWED = {
  'components/share-card-composer.tsx': [
    'feedbackSlotHeight',
    'actionRowTier',
    'useActionColumns',
    'ComposerFeedback',
  ],
}

function sourceFiles(root) {
  return SOURCE_DIRECTORIES.flatMap((directory) => {
    const walk = (relative) =>
      fs
        .readdirSync(path.join(root, relative), { withFileTypes: true })
        .flatMap((entry) => {
          const next = path.posix.join(relative, entry.name)
          if (entry.isDirectory()) return walk(next)
          if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name))
            return []
          return [next]
        })
    return fs.existsSync(path.join(root, directory)) ? walk(directory) : []
  })
}

/** The name of the nearest enclosing top-level function or component for each line. */
function enclosingNames(lines) {
  let current = null
  return lines.map((line) => {
    const match =
      /^(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/.exec(line)
    if (match) current = match[1]
    return current
  })
}

export function fontScaleReads(files) {
  const problems = []
  for (const [file, text] of Object.entries(files)) {
    const lines = text.split('\n')
    const names = enclosingNames(lines)
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      if (BANNED.test(line)) problems.push(`${file}:${index + 1} ${line.trim()}`)
      else if (FONT_SCALE.test(line) && !(ALLOWED[file] ?? []).includes(names[index]))
        problems.push(`${file}:${index + 1} ${line.trim()}`)
    })
  }
  return problems
}

describe('font-scale reads in app code', () => {
  test('only the composer layout rules read the font scale', () => {
    const files = Object.fromEntries(
      sourceFiles(mobileRoot).map((file) => [
        file,
        fs.readFileSync(path.join(mobileRoot, file), 'utf8'),
      ])
    )
    assert.ok(Object.keys(files).length > 50, 'the scan found the app sources')
    assert.deepEqual(fontScaleReads(files), [])
  })

  test('a seeded AppText that scales by fontScale is caught', () => {
    const appText = [
      "import { Text, useWindowDimensions } from 'react-native'",
      'export function AppText({ style, ...props }) {',
      '  const { fontScale } = useWindowDimensions()',
      '  return <Text {...props} allowFontScaling={false} style={[style, { fontSize: 16 * fontScale }]} />',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/app-text.tsx': appText }), [
      'components/app-text.tsx:3 const { fontScale } = useWindowDimensions()',
      'components/app-text.tsx:4 return <Text {...props} allowFontScaling={false} style={[style, { fontSize: 16 * fontScale }]} />',
    ])
  })

  test('a composer read outside its layout rules is caught', () => {
    const composer = [
      'export function ShareCardComposer() {',
      '  const { fontScale } = useWindowDimensions()',
      '}',
    ].join('\n')
    assert.equal(
      fontScaleReads({ 'components/share-card-composer.tsx': composer }).length,
      1
    )
  })
})
