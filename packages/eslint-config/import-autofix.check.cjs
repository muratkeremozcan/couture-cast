/**
 * Regression check: the shared config's two import autofixers must agree.
 *
 * Without `prefer-inline`, import/no-duplicates merged a module's value import
 * into its `import type` statement. That made the values type-only, which
 * TypeScript rejects and Metro refused to bundle (#149: every Maestro shard
 * failed). This resolves the repository's effective settings for those two
 * rules on a TypeScript file, runs exactly them over fixtures that import one
 * module twice (as types and as values), and fails unless the fix is the
 * inline form.
 *
 * Runs from `npm run lint` and `npm test` in this package.
 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { ESLint } = require('eslint')

/** Autofix spacing is Prettier's job; compare the code, not its whitespace. */
const normalize = (code) =>
  code
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()

const RULES = ['import/no-duplicates', '@typescript-eslint/consistent-type-imports']

const FIXTURES = [
  {
    name: 'type import first',
    input: `import type { Category } from './contracts'
import { resolveLocale, type Response } from './contracts'

export const locale: string = resolveLocale()
export type Pair = [Category, Response]
`,
    expected: `import { type Category, resolveLocale, type Response } from './contracts'

export const locale: string = resolveLocale()
export type Pair = [Category, Response]
`,
  },
  {
    name: 'value import first',
    input: `import { resolveLocale } from './contracts'
import type { Category } from './contracts'

export const locale: string = resolveLocale()
export type Only = Category
`,
    expected: `import { resolveLocale, type Category } from './contracts'

export const locale: string = resolveLocale()
export type Only = Category
`,
  },
]

async function main() {
  const repoRoot = path.resolve(__dirname, '../..')
  // The settings the repository actually applies to a TypeScript source file,
  // wherever they come from (this package, a preset, an override).
  const effective = await new ESLint({ cwd: repoRoot }).calculateConfigForFile(
    path.join(repoRoot, 'apps/api/src/main.ts')
  )
  const rules = Object.fromEntries(
    RULES.map((rule) => {
      assert.ok(effective.rules[rule], `the repository no longer enables ${rule}`)
      return [rule, effective.rules[rule]]
    })
  )

  const eslint = new ESLint({
    cwd: repoRoot,
    useEslintrc: false,
    fix: true,
    overrideConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: ['import', '@typescript-eslint'],
      rules,
    },
  })

  for (const fixture of FIXTURES) {
    const [result] = await eslint.lintText(fixture.input, { filePath: 'fixture.ts' })
    const output = result.output ?? fixture.input
    assert.doesNotMatch(
      output,
      /import type \{[^}]*\bresolveLocale\b/,
      `${fixture.name}: a value import was merged into an \`import type\` statement`
    )
    assert.equal(
      normalize(output),
      normalize(fixture.expected),
      `${fixture.name}: unexpected autofix output`
    )
    assert.deepEqual(
      result.messages.map((message) => message.ruleId),
      [],
      `${fixture.name}: fixed output still reports problems`
    )
  }

  console.log(`import autofix check passed (${FIXTURES.length} fixtures)`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
