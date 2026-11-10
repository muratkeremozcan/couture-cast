import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Story 6.14 TEA-05: every hand-built composition passes the complimentary seam.
 *
 * The production push sender is the community worker's own `CommunityFlagEvaluationService`,
 * built with `new` outside Nest. A site that omits the seam, passes `undefined`, or lets the
 * class build a private fallback would silently ignore every grant for push. This spec reads
 * the source with the TypeScript parser, so it fails at the construction site itself.
 * Scenario ids: U-WIRE-COMMUNITY-WORKER, U-WIRE-GENERAL-WORKER, U-WIRE-RUNTIME.
 */

const apiRoot = resolve(__dirname, '../../..')

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      found.push(...sourceFiles(path))
    } else if (
      /\.(ts|mjs)$/.test(entry.name) &&
      !/\.(spec|test)\.ts$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(path)
    }
  }
  return found
}

type Construction = {
  file: string
  className: string
  args: string[]
}

const files = [
  ...sourceFiles(join(apiRoot, 'src')),
  ...sourceFiles(join(apiRoot, 'integration')),
]

/** Per file, the identifiers bound to `new ComplimentaryAccessService(...)`. */
const seamBindings = new Map<string, string[]>()

const constructions: Construction[] = files.flatMap((path) => {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  )
  const found: Construction[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'ComplimentaryAccessService'
    ) {
      const file = relative(apiRoot, path)
      seamBindings.set(file, [...(seamBindings.get(file) ?? []), node.name.text])
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      found.push({
        file: relative(apiRoot, path),
        className: node.expression.text,
        args: (node.arguments ?? []).map((arg: ts.Expression) => arg.getText(source)),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
})

const of = (className: string) => constructions.filter((c) => c.className === className)

const isAbsent = (arg: string) => /^(undefined|null|void 0)$/.test(arg.trim())

describe('complimentary access wiring (TEA-05)', () => {
  it('U-WIRE-COMMUNITY-WORKER: every CommunityFlagEvaluationService gets prisma, remote and the seam', () => {
    const sites = of('CommunityFlagEvaluationService')
    expect(sites.map((site) => site.file)).toEqual(
      expect.arrayContaining([
        'src/workers/community.bootstrap.ts',
        'src/workers/bootstrap.ts',
        'src/modules/community/community-engagement.runtime.ts',
      ])
    )
    expect(sites.filter((site) => site.args.length !== 3)).toEqual([])
    expect(sites.filter((site) => site.args.some(isAbsent))).toEqual([])
  })

  it('U-WIRE-GENERAL-WORKER: both general-worker evaluators and the premium service get the seam', () => {
    expect(
      of('CommunityFlagEvaluationService').filter(
        (site) => site.file === 'src/workers/bootstrap.ts'
      )
    ).toHaveLength(2)
    const premium = of('PremiumEntitlementService')
    expect(premium.map((site) => site.file)).toContain('src/workers/bootstrap.ts')
    expect(premium.filter((site) => site.args.length !== 4)).toEqual([])
    expect(premium.filter((site) => site.args.some(isAbsent))).toEqual([])
    const flags = of('FeatureFlagsService')
    expect(flags.filter((site) => site.args.length !== 4)).toEqual([])
    expect(flags.filter((site) => isAbsent(site.args[3] ?? 'undefined'))).toEqual([])
  })

  it('U-WIRE-RUNTIME: the send guard evaluator in the engagement runtime gets the seam', () => {
    const runtime = of('CommunityFlagEvaluationService').filter(
      (site) => site.file === 'src/modules/community/community-engagement.runtime.ts'
    )
    expect(runtime).toHaveLength(1)
    expect(runtime[0]!.args).toHaveLength(3)
    expect(isAbsent(runtime[0]!.args[2]!)).toBe(false)
  })

  it('TEA-05: every production site passes the real seam, inline or bound in the same file (seeded defect S-8)', () => {
    // A stand-in object such as `{ isActive: async () => false }` counts as an argument,
    // so argument counts alone cannot catch a worker that silently ignores every grant.
    const seamIndex: Record<string, number> = {
      CommunityFlagEvaluationService: 2,
      PremiumEntitlementService: 3,
      FeatureFlagsService: 3,
    }
    const notRealSeam = constructions
      .filter((site) => site.file.startsWith('src/') && site.className in seamIndex)
      .filter((site) => {
        const arg = (site.args[seamIndex[site.className]!] ?? '').trim()
        if (/^new ComplimentaryAccessService\(/.test(arg)) return false
        return !(seamBindings.get(site.file) ?? []).includes(arg)
      })
    expect(notRealSeam).toEqual([])
    expect(
      constructions.filter(
        (site) => site.file.startsWith('src/') && site.className in seamIndex
      ).length
    ).toBeGreaterThanOrEqual(7)
  })

  it('TEA-05: the seam never imports FeatureFlagsService, which already depends on the cache', () => {
    const seam = readFileSync(
      resolve(__dirname, 'complimentary-access.service.ts'),
      'utf8'
    )
    const source = ts.createSourceFile('seam.ts', seam, ts.ScriptTarget.Latest, true)
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text)
    expect(
      imports.filter((specifier) => /feature-flags\.service/.test(specifier))
    ).toEqual([])
    expect(
      imports.filter((specifier) => /community-flag-evaluation/.test(specifier))
    ).toEqual([])
  })

  it('TEA-05: only the hand-built compositions construct the seam; no class builds a private fallback', () => {
    const allowed = [
      'src/workers/bootstrap.ts',
      'src/workers/community.bootstrap.ts',
      'src/modules/community/community-engagement.runtime.ts',
    ]
    const builders = of('ComplimentaryAccessService')
      .map((site) => site.file)
      .filter((file) => file.startsWith('src/'))
    expect(builders.filter((file) => !allowed.includes(file))).toEqual([])
  })
})
