// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { boundedSpawn } from './test-store-spawn.mjs'

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

const BOUNDING_CALLS = new Set(['spawnSync', 'execFileSync', 'execSync'])
const propName = (property) =>
  property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : null

/** Whether an object literal bounds the call: timeout and killSignal 'SIGKILL', set after any
 * spread that could override them, or a spread of a bounding constant. */
function boundsObject(object, boundingNames) {
  let timeout = false
  let killed = false
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (
        ts.isIdentifier(property.expression) &&
        boundingNames.has(property.expression.text)
      ) {
        timeout = true
        killed = true
      } else {
        // Anything spread later could override what came before.
        timeout = false
        killed = false
      }
      continue
    }
    const name = propName(property)
    if (name === 'timeout') timeout = true
    if (
      name === 'killSignal' &&
      ts.isPropertyAssignment(property) &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === 'SIGKILL'
    )
      killed = true
  }
  return timeout && killed
}

/** Every spawnSync, execFileSync or execSync call in `file` that is not bounded. */
export function unboundedCalls(file, source = fs.readFileSync(file, 'utf8')) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  // Constants whose initializer bounds a call: const BOUNDED = { timeout, killSignal: 'SIGKILL' }.
  const boundingNames = new Set()
  const collect = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer) &&
      boundsObject(node.initializer, boundingNames)
    )
      boundingNames.add(node.name.text)
    ts.forEachChild(node, collect)
  }
  collect(tree)
  const misses = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null
      if (BOUNDING_CALLS.has(name)) {
        const options = node.arguments.at(-1)
        const bounded =
          options &&
          ((ts.isIdentifier(options) && boundingNames.has(options.text)) ||
            (ts.isObjectLiteralExpression(options) &&
              boundsObject(options, boundingNames)))
        if (!bounded) {
          const { line } = tree.getLineAndCharacterOfPosition(node.getStart())
          misses.push(`${file}:${line + 1}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { misses, boundingNames: [...boundingNames] }
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

test('the bound check rejects what it should', () => {
  const misses = (source) => unboundedCalls('x.mjs', source).misses.length
  assert.equal(misses("spawnSync('a', [])"), 1)
  assert.equal(misses("spawnSync('a', [], { timeout: 1 })"), 1)
  assert.equal(misses("spawnSync('a', [], { timeout: 1, killSignal: 'SIGTERM' })"), 1)
  assert.equal(
    misses("spawnSync('a', [], { timeout: 1, killSignal: 'SIGKILL', ...rest })"),
    1
  )
  assert.equal(misses("cp.execSync('a', { encoding: 'utf8' })"), 1)
  assert.equal(misses("execFileSync('a', [], { timeout, killSignal: 'SIGKILL' })"), 0)
  assert.equal(
    misses(
      "const B = { timeout: 1, killSignal: 'SIGKILL' }\nspawnSync('a', [], { ...B, cwd })"
    ),
    0
  )
  assert.equal(
    misses("const B = { timeout: 1, killSignal: 'SIGKILL' }\nspawnSync('a', [], B)"),
    0
  )
  // Text that only mentions the call is not a call.
  assert.equal(misses("// spawnSync('a')\nconst s = 'spawnSync(x)'"), 0)
})
