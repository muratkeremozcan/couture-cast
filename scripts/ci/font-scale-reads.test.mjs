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
// function BANNED_ALLOWED gives it, and only in the form its test there accepts. Names are scoped
// by the TypeScript AST's function bodies, so code after a function never inherits its
// allowance, and a name spelled as a string (`dimensions['fontScale']`) counts as the name. A key
// folds through parentheses, `+` of strings, plain templates and string constants; a key on a
// dimensions value or PixelRatio that folds to nothing fails as unverifiable (r49 P2-5).
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

/** The expression inside any parentheses, non-null assertions, `as` and `satisfies`. */
function unwrap(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression
  return current
}

/** Every `const` of the file whose value folds to a string (foldKey), by name. */
function constantStrings(source) {
  const constants = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const value = foldKey(node.initializer, constants)
      if (value !== null) constants.set(node.name.text, value)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return constants
}

/**
 * The string a key expression always is (r49 P2-5), or null: a string or plain template, in
 * parentheses or not, a `+` of such strings, or a `const` holding one.
 */
function foldKey(expression, constants) {
  const node = unwrap(expression)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isIdentifier(node)) return constants.get(node.text) ?? null
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = foldKey(node.left, constants)
    const right = foldKey(node.right, constants)
    return left === null || right === null ? null : left + right
  }
  return null
}

/**
 * Whether an expression is a window or screen dimensions value or PixelRatio, where any key may
 * be the font scale: useWindowDimensions(), Dimensions.get(...), PixelRatio, Dimensions, or a
 * name the file binds to one of them.
 */
function dimensionsValue(expression, dimensionsNames) {
  const node = unwrap(expression)
  if (ts.isIdentifier(node))
    return (
      ['PixelRatio', 'Dimensions'].includes(node.text) || dimensionsNames.has(node.text)
    )
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression)
    if (ts.isIdentifier(callee)) return callee.text === 'useWindowDimensions'
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'get' &&
      ts.isIdentifier(unwrap(callee.expression)) &&
      unwrap(callee.expression).text === 'Dimensions'
    )
  }
  return false
}

/** The names the file binds to a dimensions value (dimensionsValue), as a variable's value. */
function dimensionsBindings(source) {
  const names = new Set()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      dimensionsValue(node.initializer, names)
    )
      names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

/**
 * The value a destructuring takes apart, for the property `element` of its pattern: a
 * declaration's value, or the right side of an assignment (`({ [k]: s } = dims)`); null else.
 */
function patternSource(element) {
  let current = element.parent
  while (
    current.parent &&
    (ts.isBindingElement(current.parent) ||
      ts.isObjectBindingPattern(current.parent) ||
      ts.isParenthesizedExpression(current.parent))
  )
    current = current.parent
  const parent = current.parent
  if (ts.isVariableDeclaration(parent) && parent.name === current)
    return parent.initializer ?? null
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    unwrap(parent.left) === current
  )
    return parent.right
  return null
}

/**
 * The name a node reads or binds (r48 P2-4, r49 P2-5): an identifier; a string a property is
 * named by as a quoted property name in an object or a destructuring, or a JSX attribute; or,
 * for an element access or a computed property name, its key folded to a string (foldKey). A
 * key that folds to no string, on a dimensions value or PixelRatio (dimensionsValue), is
 * `UNVERIFIABLE`: it might be the font scale. Null for any other node, so a string that names
 * no property (a log line, a test ID) passes.
 */
function nameOf(node, names) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isElementAccessExpression(node) || ts.isComputedPropertyName(node))
    return keyName(node, names)
  return quotedName(node)
}

/** An element access's or a computed property name's key, folded (nameOf). */
function keyName(node, { constants, dimensionsNames }) {
  const access = ts.isElementAccessExpression(node)
  const key = foldKey(access ? node.argumentExpression : node.expression, constants)
  if (key !== null) return key
  if (access)
    return dimensionsValue(node.expression, dimensionsNames) ? UNVERIFIABLE : null
  const element = node.parent
  if (!ts.isBindingElement(element) && !ts.isPropertyAssignment(element)) return null
  const value = patternSource(element)
  return value && dimensionsValue(value, dimensionsNames) ? UNVERIFIABLE : null
}

/** A string naming a property: quoted in an object or a destructuring, or a JSX attribute. */
function quotedName(node) {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null
  const parent = node.parent
  const named =
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
      parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node)
  return named ? node.text : null
}

/** A key nothing can fold, on a value whose keys include the font scale. */
const UNVERIFIABLE = Symbol('unverifiable font-scale key')

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
    const names = {
      constants: constantStrings(source),
      dimensionsNames: dimensionsBindings(source),
    }
    const visit = (node) => {
      const name = nameOf(node, names)
      if (name !== null) {
        const scope = scopeOf(node)
        const allowed =
          name === UNVERIFIABLE
            ? false
            : BANNED_NAMES.has(name)
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

  // r48 P2-4 (probe R47_F1_string_bracket): a read by string or template element access passed.
  test('a font-scale name spelled as a string property is caught', () => {
    const reads = [
      'export function AppText() {',
      "  const scale = useWindowDimensions()['fontScale']",
      '  const cap = props[`maxFontSizeMultiplier`]',
      "  const { 'fontScale': quoted } = useWindowDimensions()",
      "  const style = { ['allowFontScaling']: false }",
      "  const label = 'fontScale is read by the composer only'",
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/app-text.tsx': reads }), [
      "components/app-text.tsx:2 const scale = useWindowDimensions()['fontScale']",
      'components/app-text.tsx:3 const cap = props[`maxFontSizeMultiplier`]',
      "components/app-text.tsx:4 const { 'fontScale': quoted } = useWindowDimensions()",
      "components/app-text.tsx:5 const style = { ['allowFontScaling']: false }",
    ])
    // Inside an allowed function the string form passes as the identifier does.
    const glyph = [
      'export function glyphBoxSide(base) {',
      "  return base * useWindowDimensions()['fontScale']",
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/glyph-box.ts': glyph }), [])
  })

  // r49 P2-5 (probe 5.ast_guard): parentheses, a concatenation, a template and a const key all
  // passed; a key nothing folds, on a dimensions value, is unverifiable.
  test('a font-scale key in parentheses, folded or unverifiable is caught', () => {
    const reads = [
      'export function AppText() {',
      "  const a = useWindowDimensions()[('fontScale')]",
      "  const { [('fontScale')]: b } = useWindowDimensions()",
      "  const c = useWindowDimensions()['font' + 'Scale']",
      "  const KEY = 'font' + `Scale`",
      '  const d = useWindowDimensions()[KEY]',
      '  const dims = Dimensions.get(`window`)',
      '  const e = dims[`font${suffix}`]',
      '  const f = PixelRatio[name]',
      '  const { [name]: g } = useWindowDimensions()',
      '  const h = rows[index]',
      "  const i = { [('maxFontSize' + 'Multiplier')]: 2 }",
      '  ;({ [name]: g } = useWindowDimensions())',
      '  const j = { [name]: 2 }',
      '}',
    ].join('\n')
    assert.deepEqual(
      fontScaleReads({ 'components/app-text.tsx': reads }).map(
        (line) => line.split(' ')[0]
      ),
      [2, 3, 4, 6, 8, 9, 10, 12, 13].map((line) => `components/app-text.tsx:${line}`)
    )
  })

  // r52 mutant M9a: a const key folds to its value, so a safe one passes and the font scale is
  // reported by name; neither is left unverifiable.
  test('a const key folds to its value on a dimensions value', () => {
    const safe = [
      'export function AppText() {',
      "  const KEY = 'width'",
      '  return useWindowDimensions()[KEY]',
      '}',
    ].join('\n')
    assert.deepEqual(fontScaleReads({ 'components/app-text.tsx': safe }), [])
    const scale = safe.replace("'width'", "'fontScale'")
    assert.deepEqual(fontScaleReads({ 'components/app-text.tsx': scale }), [
      'components/app-text.tsx:3 return useWindowDimensions()[KEY]',
    ])
    // Folded, the font scale passes where it is allowed, which an unverifiable key never does.
    const allowed = scale.replace(
      'export function AppText()',
      'export function glyphBoxSide()'
    )
    assert.deepEqual(fontScaleReads({ 'components/glyph-box.ts': allowed }), [])
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
