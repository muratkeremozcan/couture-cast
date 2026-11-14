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
// One read outside the composer drives no layout: `LiveFontMountMarker` reports the scale
// JavaScript sees to the live font-scale proof (Codex R2-03), in development and isolated
// native test builds only.
// Story 6.15 F-00i adds three layout rules that size a box to the text it holds, none of which
// wraps or rescales app text:
// - `glyphScale`, `glyphBoxSide` and `useGlyphBox` (glyph-box.ts): a fixed box around one glyph
//   grows by the scale the glyph is drawn at, capped by the glyph's own maxFontSizeMultiplier;
// - `tabBarGrowth`, `recordTabLabelHeight`, `tallestTabLabel`, `useTabBarSizing` and
//   `TabBarLabel` (tab-bar-label.tsx): the tab bar grows by what its labels grew, and a label fits
//   its tab; on iOS the label keeps React Navigation's allowFontScaling false, since the tab's
//   Large Content Viewer shows it at the user's size.
// A banned name (allowFontScaling, maxFontSizeMultiplier, getFontScale) passes only in the one
// function BANNED_ALLOWED gives it, and only on a line matching its pattern there. Names are scoped
// by real function bodies (brace depth), so code after a function never inherits its allowance.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
  'components/live-font-mount-marker.tsx': ['LiveFontMountMarker'],
  'components/glyph-box.ts': ['glyphScale', 'glyphBoxSide', 'useGlyphBox'],
  'components/tab-bar-label.tsx': [
    'tabBarGrowth',
    'recordTabLabelHeight',
    'tallestTabLabel',
    'useTabBarSizing',
    'TabBarLabel',
    // A type with a fontScale field: the scale the stored label heights were measured at.
    'TabLabelHeights',
  ],
}
/** file -> function -> banned name -> the pattern a line must match to use it there. */
const BANNED_ALLOWED = {
  'components/glyph-box.ts': { glyphScale: { maxFontSizeMultiplier: /./ } },
  'components/tab-bar-label.tsx': {
    TabBarLabel: {
      allowFontScaling:
        /allowFontScaling=\{Platform\.OS === 'ios' \? false : undefined\}/,
    },
  },
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

/**
 * The top-level function or component each line belongs to, from the TypeScript parser: a
 * top-level function, or a const, owns exactly the lines of its own statement, so code after it
 * (a trailing class, another statement) belongs to no function.
 */
function enclosingNames(text, file) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const names = text.split('\n').map(() => null)
  for (const statement of source.statements) {
    let name = null
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    )
      name = statement.name?.text ?? null
    else if (ts.isVariableStatement(statement)) {
      const [declaration] = statement.declarationList.declarations
      if (declaration && ts.isIdentifier(declaration.name)) name = declaration.name.text
    }
    if (!name) continue
    const first = source.getLineAndCharacterOfPosition(statement.getStart(source)).line
    const last = source.getLineAndCharacterOfPosition(statement.getEnd()).line
    for (let line = first; line <= last; line += 1) names[line] = name
  }
  return names
}

export function fontScaleReads(files) {
  const problems = []
  for (const [file, text] of Object.entries(files)) {
    const lines = text.split('\n')
    const names = enclosingNames(text, file)
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      const banned = BANNED.exec(line)?.[1]
      if (banned) {
        const pattern = BANNED_ALLOWED[file]?.[names[index]]?.[banned]
        if (!pattern?.test(line)) problems.push(`${file}:${index + 1} ${line.trim()}`)
      } else if (FONT_SCALE.test(line) && !(ALLOWED[file] ?? []).includes(names[index]))
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

  test('a banned name outside the functions allowed to use it is caught', () => {
    // Story 6.15: tabBarGrowth may read the scale, but only TabBarLabel may set allowFontScaling.
    const label = [
      'export function tabBarGrowth(heights, fontScale) {',
      '  return <Text allowFontScaling={false} />',
      '}',
      'export function TabBarLabel() {',
      "  return <Text allowFontScaling={Platform.OS === 'ios' ? false : undefined} />",
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/tab-bar-label.tsx': label }), [
      'components/tab-bar-label.tsx:2 return <Text allowFontScaling={false} />',
    ])
  })

  test('r46 PROBE_F1A: a font-scale read in the tab layout is caught', () => {
    const layout = [
      'export default function TabLayout() {',
      '  const { fontScale } = useWindowDimensions()',
      '  return <Text style={{ fontSize: 16 * fontScale }} />',
      '}',
    ].join('\n')
    assert.equal(fontScaleReads({ 'app/(tabs)/_layout.tsx': layout }).length, 2)
  })

  test('r46 PROBE_F1B: code after an allowed function does not inherit its allowance', () => {
    const glyph = [
      'export function useGlyphBox(base, round) {',
      '  const { fontScale } = useWindowDimensions()',
      '  return { width: base * fontScale }',
      '}',
      'class GlobalTextScaler {',
      '  scale(fontScale) { return 16 * fontScale }',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/glyph-box.ts': glyph }), [
      'components/glyph-box.ts:6 scale(fontScale) { return 16 * fontScale }',
    ])
  })

  test('a banned name passes only in its one function and only in its allowed form', () => {
    const label = [
      'export function TabBarLabel() {',
      '  return <Text allowFontScaling={false} maxFontSizeMultiplier={1} />',
      '}',
    ].join('\n')
    assert.equal(fontScaleReads({ 'components/tab-bar-label.tsx': label }).length, 1)
    const glyph = [
      'export function useGlyphBox(base, round, maxFontSizeMultiplier) {',
      '  return base',
      '}',
    ].join('\n')
    assert.equal(fontScaleReads({ 'components/glyph-box.ts': glyph }).length, 1)
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
