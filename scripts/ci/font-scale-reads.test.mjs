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
/** Directories under apps/mobile that hold no app TypeScript: dependencies and native projects. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'ios',
  'android',
  '.expo',
  'dist',
  'build',
  'coverage',
])
const BANNED_NAMES = new Set([
  'getFontScale',
  'maxFontSizeMultiplier',
  'allowFontScaling',
])
const FONT_SCALE = 'fontScale'
/**
 * file -> the functions allowed to read the font scale, by scope path: a nested named function
 * is its own scope, written outer.inner, and never inherits its outer function's allowance.
 * Anonymous callbacks (a map callback, a useCallback body) belong to the function around them.
 */
const ALLOWED = {
  'components/share-card-composer.tsx': [
    'feedbackSlotHeight',
    'actionRowTier',
    'actionRowTier.oneLine',
    'useActionColumns',
    // The label measure callback that feeds actionRowTier the scale it measured at.
    'useActionColumns.measure',
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
/**
 * file -> scope path -> banned name -> a test of the use: the name passes only in that one scope
 * and only in that form, each occurrence checked on its own.
 */
const BANNED_ALLOWED = {
  'components/glyph-box.ts': { glyphScale: { maxFontSizeMultiplier: () => true } },
  'components/tab-bar-label.tsx': {
    TabBarLabel: {
      // React Navigation's iOS label, which the tab's Large Content Viewer shows at full size.
      allowFontScaling: (node, source) =>
        ts.isJsxAttribute(node.parent) &&
        node.parent.initializer?.getText(source) ===
          "{Platform.OS === 'ios' ? false : undefined}",
    },
  },
}

function sourceFiles(root) {
  const walk = (relative) =>
    fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .flatMap((entry) => {
        const next = relative ? path.posix.join(relative, entry.name) : entry.name
        if (entry.isDirectory())
          return SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')
            ? []
            : walk(next)
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name))
          return []
        return [next]
      })
  return walk('')
}

/** The name a function-like node is known by, or null for an anonymous callback. */
function functionName(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
    return node.name?.getText() ?? null
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (node.name) return node.name.getText()
    const parent = node.parent
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return parent.name.text
    if (ts.isPropertyAssignment(parent)) return parent.name.getText()
  }
  return null
}

/**
 * The scope path a node belongs to: its named functions from outermost to innermost (outer.inner),
 * or, outside any function, the top-level type or interface it sits in; null elsewhere.
 */
function scopeOf(node) {
  const names = []
  let typeName = null
  for (let current = node.parent; current; current = current.parent) {
    const name = ts.isFunctionLike(current) ? functionName(current) : null
    if (name) names.unshift(name)
    if (
      (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) &&
      ts.isSourceFile(current.parent)
    )
      typeName = current.name.text
  }
  return names.length > 0 ? names.join('.') : typeName
}

export function fontScaleReads(files) {
  const problems = []
  for (const [file, text] of Object.entries(files)) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    const lines = text.split('\n')
    const flagged = new Set()
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        const scope = scopeOf(node)
        const name = node.text
        const allowed = BANNED_NAMES.has(name)
          ? (BANNED_ALLOWED[file]?.[scope]?.[name]?.(node, source) ?? false)
          : name === FONT_SCALE
            ? (ALLOWED[file] ?? []).includes(scope)
            : true
        if (!allowed)
          flagged.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const line of [...flagged].sort((a, b) => a - b))
      problems.push(`${file}:${line + 1} ${lines[line].trim()}`)
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

  test('r47 R47_F1: every banned name on a line is checked on its own', () => {
    const label = [
      'export function TabBarLabel() {',
      "  return <Text allowFontScaling={Platform.OS === 'ios' ? false : undefined} maxFontSizeMultiplier={1} />",
      '}',
    ].join('\n')
    assert.equal(fontScaleReads({ 'components/tab-bar-label.tsx': label }).length, 1)
    const glyph = [
      'function glyphScale(fontScale, maxFontSizeMultiplier) {',
      '  return maxFontSizeMultiplier && <Text allowFontScaling={false} />',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/glyph-box.ts': glyph }), [
      'components/glyph-box.ts:2 return maxFontSizeMultiplier && <Text allowFontScaling={false} />',
    ])
  })

  test('allowFontScaling passes in TabBarLabel only as the iOS-only expression', () => {
    const label = [
      'export function TabBarLabel() {',
      "  const ios = <Text allowFontScaling={Platform.OS === 'ios' ? false : undefined} />",
      '  return <Text allowFontScaling={false} />',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/tab-bar-label.tsx': label }), [
      'components/tab-bar-label.tsx:3 return <Text allowFontScaling={false} />',
    ])
  })

  test('r47 R47_F1: each declarator and each nested function is its own scope', () => {
    const multi = [
      'export const glyphBoxSide = (base, fontScale) => base * fontScale,',
      '  EvilScaler = (fontScale) => 16 * fontScale',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/glyph-box.ts': multi }), [
      'components/glyph-box.ts:2 EvilScaler = (fontScale) => 16 * fontScale',
    ])
    const nested = [
      'export function TabBarLabel() {',
      '  const { fontScale } = useWindowDimensions()',
      '  function AppText() {',
      '    return <Text style={{ fontSize: 16 * fontScale }} />',
      '  }',
      '  return null',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/tab-bar-label.tsx': nested }), [
      'components/tab-bar-label.tsx:4 return <Text style={{ fontSize: 16 * fontScale }} />',
    ])
  })

  test('the scan covers every app source under apps/mobile, not three folders', () => {
    const files = sourceFiles(mobileRoot)
    assert.ok(files.includes('index.ts'), 'the entry file is scanned')
    assert.ok(
      files.some((file) => file.startsWith('constants/')),
      'constants are scanned'
    )
    assert.ok(!files.some((file) => /(^|\/)(node_modules|ios|android)\//.test(file)))
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
