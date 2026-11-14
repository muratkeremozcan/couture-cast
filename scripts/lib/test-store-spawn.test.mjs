// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { boundedSpawn, boundOf } from './test-store-spawn.mjs'

// Antigravity r21 (1): a side call killed at its bound fails the run with its code.
test('a hung call past its bound throws its code; a tolerated nonzero exit does not', () => {
  const started = Date.now()
  assert.throws(
    () =>
      boundedSpawn('sh', ['-c', 'sleep 5'], {
        code: 'test_store_uninstall_failed',
        timeout: 200,
      }),
    (error) =>
      error.code === 'test_store_uninstall_failed' && /ETIMEDOUT/.test(error.message)
  )
  assert.ok(Date.now() - started < 3_000)
  // An app that is not installed: nonzero, no error, tolerated.
  assert.equal(
    boundedSpawn('sh', ['-c', 'exit 1'], { code: 'x_y', tolerateStatus: true }).status,
    1
  )
  assert.throws(
    () => boundedSpawn('sh', ['-c', 'exit 1'], { code: 'test_store_rev_failed' }),
    (error) => error.code === 'test_store_rev_failed'
  )
  assert.throws(
    () =>
      boundedSpawn('/nonexistent/tool', [], {
        code: 'test_store_stop_failed',
        tolerateStatus: true,
      }),
    (error) => error.code === 'test_store_stop_failed' && /ENOENT/.test(error.message)
  )
})

const SPAWN_FUNCTIONS = new Set(['spawnSync', 'execFileSync', 'execSync'])
const CHILD_PROCESS = new Set(['node:child_process', 'child_process'])
const propName = (property) =>
  property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : null
const isConst = (statement) =>
  ts.isVariableStatement(statement) &&
  (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
const positiveLiteral = (node) =>
  node && ts.isNumericLiteral(node) && Number(node.text.replaceAll('_', '')) > 0

const importedName = (element) => (element.propertyName ?? element.name).text

/** One import of child_process: its default, namespace and spawn-function local names. */
function childProcessNames(clause, found) {
  const bindings = clause.namedBindings
  if (clause.name) found.moduleNames.add(clause.name.text)
  if (bindings && ts.isNamespaceImport(bindings))
    found.moduleNames.add(bindings.name.text)
  if (bindings && ts.isNamedImports(bindings))
    for (const element of bindings.elements)
      if (SPAWN_FUNCTIONS.has(importedName(element)))
        found.spawnNames.add(element.name.text)
}

/** The child_process bindings a file imports, and its local name for boundOf. */
function readImports(tree, file) {
  const found = {
    spawnNames: new Set(),
    moduleNames: new Set(),
    boundOfName: path.basename(file) === 'test-store-spawn.mjs' ? 'boundOf' : null,
  }
  for (const statement of tree.statements) {
    const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined
    if (!clause || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const from = statement.moduleSpecifier.text
    if (CHILD_PROCESS.has(from)) childProcessNames(clause, found)
    const bindings = clause.namedBindings
    if (
      from.endsWith('test-store-spawn.mjs') &&
      bindings &&
      ts.isNamedImports(bindings)
    ) {
      const element = bindings.elements.find((each) => importedName(each) === 'boundOf')
      if (element) found.boundOfName = element.name.text
    }
  }
  return found
}

/** The bound rules for one file: timeout values, option objects, and its top-level consts. */
function boundRules(tree, boundOfName) {
  const boundConsts = new Set()
  const boundingConsts = new Set()
  const goodTimeout = (node) =>
    positiveLiteral(node) ||
    (node && ts.isIdentifier(node) && boundConsts.has(node.text)) ||
    (node &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === boundOfName)
  const boundsObject = (object) => {
    let timeout = false
    let killed = false
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        // A bounding constant sets both; anything else spread here could override both.
        timeout = killed =
          ts.isIdentifier(property.expression) &&
          boundingConsts.has(property.expression.text)
        continue
      }
      const name = propName(property)
      const value = ts.isPropertyAssignment(property) ? property.initializer : null
      if (name === 'timeout') timeout = Boolean(value) && goodTimeout(value)
      if (name === 'killSignal')
        killed = Boolean(value) && ts.isStringLiteral(value) && value.text === 'SIGKILL'
    }
    return timeout && killed
  }
  // Top-level consts only: a let, or a const in a function, can be anything by the time of use.
  for (const statement of tree.statements.filter(isConst))
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (!ts.isIdentifier(name) || !initializer) continue
      if (goodTimeout(initializer)) boundConsts.add(name.text)
      if (ts.isObjectLiteralExpression(initializer) && boundsObject(initializer))
        boundingConsts.add(name.text)
    }
  const boundedOptions = (options) =>
    Boolean(options) &&
    ((ts.isIdentifier(options) && boundingConsts.has(options.text)) ||
      (ts.isObjectLiteralExpression(options) && boundsObject(options)))
  return { boundedOptions }
}

const isCallee = (node) =>
  ts.isCallExpression(node.parent) && node.parent.expression === node
const isBindingName = (node) =>
  (ts.isImportSpecifier(node.parent) ||
    ts.isNamespaceImport(node.parent) ||
    ts.isImportClause(node.parent)) &&
  node.parent.name === node
const isMemberName = (node) =>
  ts.isPropertyAccessExpression(node.parent) && node.parent.name === node

/**
 * Every spawnSync, execFileSync or execSync use in `source` that is not a bounded direct call
 * (Antigravity r22). It resolves the child_process imports (named, aliased, namespace and
 * default), fails any reference to a spawn function that is not a direct callee and any bracket
 * or value use of the module, accepts bounding constants only from top-level const declarations,
 * and requires timeout to be a positive number literal, a top-level const bound, or boundOf(...)
 * from test-store-spawn.mjs, with killSignal 'SIGKILL' after any spread that could override it.
 */
export function unboundedCalls(file, source = fs.readFileSync(file, 'utf8')) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const { spawnNames, moduleNames, boundOfName } = readImports(tree, file)
  const { boundedOptions } = boundRules(tree, boundOfName)
  const misses = []
  const miss = (node, why) => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart())
    misses.push(`${file}:${line + 1} ${why}`)
  }
  const use = (node, name) => {
    if (!isCallee(node)) miss(node, `${name} used other than as a direct callee`)
    else if (!boundedOptions(node.parent.arguments.at(-1))) miss(node, 'unbounded call')
  }
  const visit = (node) => {
    if (ts.isIdentifier(node) && !isBindingName(node) && !isMemberName(node)) {
      if (spawnNames.has(node.text)) use(node, node.text)
      if (moduleNames.has(node.text)) {
        const access = node.parent
        const viaProperty =
          ts.isPropertyAccessExpression(access) && access.expression === node
        if (!viaProperty)
          miss(node, `${node.text} (child_process) used other than by property`)
        else if (SPAWN_FUNCTIONS.has(access.name.text)) use(access, access.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { misses }
}

// Antigravity r21 (3): the driver and every Test Store helper it loads, read as syntax.
test('every spawnSync, execFileSync and execSync in the Test Store driver and helpers is bounded', () => {
  const files = [
    'scripts/run-test-store-journey.mjs',
    ...fs
      .readdirSync('scripts/lib')
      .filter(
        (name) => /^test-store-[a-z-]+\.mjs$/.test(name) && !name.includes('.test.')
      )
      .map((name) => path.join('scripts/lib', name)),
  ]
  let calls = 0
  for (const file of files) {
    const { misses } = unboundedCalls(file)
    assert.deepEqual(misses, [], file)
    calls += (
      fs.readFileSync(file, 'utf8').match(/\b(?:spawnSync|execFileSync|execSync)\(/g) ??
      []
    ).length
  }
  assert.ok(calls >= 5, String(calls))
})

test('the bound check rejects every bypass', () => {
  const misses = (
    body,
    header = "import { spawnSync, execSync } from 'node:child_process'"
  ) => unboundedCalls('x.mjs', `${header}\n${body}`).misses
  const bound = "{ timeout: 1000, killSignal: 'SIGKILL' }"
  // Bypasses, one each (Antigravity r21 and r22): every one is reported.
  for (const [name, body, header] of [
    ['no options', "spawnSync('a', [])"],
    ['timeout only', "spawnSync('a', [], { timeout: 1 })"],
    ['SIGTERM', "spawnSync('a', [], { timeout: 1, killSignal: 'SIGTERM' })"],
    ['spread after the bound', `spawnSync('a', [], { ...${bound}, ...rest })`],
    ['timeout 0', "spawnSync('a', [], { timeout: 0, killSignal: 'SIGKILL' })"],
    [
      'timeout undefined',
      "spawnSync('a', [], { timeout: undefined, killSignal: 'SIGKILL' })",
    ],
    [
      'timeout from a variable',
      "spawnSync('a', [], { timeout: ms, killSignal: 'SIGKILL' })",
    ],
    ['shorthand timeout', "spawnSync('a', [], { timeout, killSignal: 'SIGKILL' })"],
    [
      'aliased import',
      "r('a', [])",
      "import { spawnSync as r } from 'node:child_process'",
    ],
    ['reassigned', "const s = spawnSync\ns('a', [], B)"],
    ['passed as a value', 'run(spawnSync)'],
    [
      'namespace call unbounded',
      "cp.spawnSync('a', [])",
      "import * as cp from 'node:child_process'",
    ],
    [
      'bracket access',
      `cp['spawnSync']('a', [], ${bound})`,
      "import * as cp from 'node:child_process'",
    ],
    ['namespace passed on', 'use(cp)', "import * as cp from 'node:child_process'"],
    ['default import unbounded', "cp.execSync('a')", "import cp from 'child_process'"],
    ['let bounding constant', `let B = ${bound}\nB = {}\nspawnSync('a', [], B)`],
    [
      'bounding constant inside a function',
      `function f() {\n  const B = ${bound}\n  return spawnSync('a', [], B)\n}`,
    ],
  ])
    assert.notDeepEqual(misses(body, header), [], name)
  // What the driver and helpers really write passes.
  for (const [name, body, header] of [
    ['literal', `spawnSync('a', [], ${bound})`],
    [
      'top-level const',
      `const B = ${bound}\nspawnSync('a', [], B)\nexecSync('b', { ...B, cwd })`,
    ],
    [
      'top-level const bound',
      "const MS = 5_000\nspawnSync('a', [], { timeout: MS, killSignal: 'SIGKILL' })",
    ],
    [
      'boundOf',
      "spawnSync('a', [], { ...rest, timeout: boundOf(t), killSignal: 'SIGKILL' })",
      "import { spawnSync } from 'node:child_process'\nimport { boundOf } from './test-store-spawn.mjs'",
    ],
    [
      'namespace call',
      `cp.execFileSync('a', [], ${bound})`,
      "import * as cp from 'node:child_process'",
    ],
    ['text only', "// spawnSync('a')\nconst s = 'spawnSync(x)'"],
  ])
    assert.deepEqual(misses(body, header), [], name)
})

// Antigravity r22 (1): a bound is a positive safe integer, or the run fails coded.
test('boundOf takes positive safe integers and refuses 0, text, negatives, fractions and unsafe', () => {
  assert.equal(boundOf(300), 300)
  assert.equal(boundOf('300'), 300)
  for (const value of [
    0,
    '0',
    'abc',
    '',
    -5,
    '-5',
    1.5,
    '1.5',
    2 ** 53,
    '9007199254740993',
    NaN,
    undefined,
  ])
    assert.throws(
      () => boundOf(value),
      (error) => error.code === 'test_store_spawn_timeout_invalid',
      String(value)
    )
  // boundedSpawn checks its own bound too, before anything runs.
  assert.throws(
    () =>
      boundedSpawn('sh', ['-c', 'exit 0'], {
        code: 'test_store_stop_failed',
        timeout: 0,
      }),
    (error) => error.code === 'test_store_spawn_timeout_invalid'
  )
})
