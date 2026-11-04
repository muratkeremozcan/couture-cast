// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-WEB-Q-NO-DIRECT. The console reads only the API (epics.md AC3, D12).
// A static scan: the console sources import no database, Supabase table or storage client, and
// declare no server action that could reach the tables around the API.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const consoleSources = [
  ...files(join(SRC, 'app', 'moderation')),
  ...readdirSync(join(SRC, 'app', 'components'))
    .filter((name) => /^moderation-/.test(name))
    .map((name) => join(SRC, 'app', 'components', name)),
  join(SRC, 'lib', 'moderation.ts'),
].filter((path) => /\.(ts|tsx)$/.test(path) && !/\.(test|spec)\.(ts|tsx)$/.test(path))

/**
 * Every reference to `fetch` in a source: an identifier named fetch (a call, `fetch.call`, an alias,
 * `globalThis.fetch` and `window.fetch` all end in one) or an element access with the literal
 * 'fetch' (`globalThis['fetch']`). A parsed tree ignores comments and strings, so no spelling
 * of the call slips past the way a pattern would.
 */
function fetchReferences(source: string): string[] {
  const tree = ts.createSourceFile(
    'scan.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const found: string[] = []
  const visit = (node: ts.Node) => {
    const isName = ts.isIdentifier(node) && node.text === 'fetch'
    const isElement =
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'fetch'
    if (isName || isElement) found.push(node.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

describe('U-WEB-Q-NO-DIRECT', () => {
  it.each([
    'fetch(url)',
    'fetch (url)',
    'fetch?.(url)',
    'fetch ?. (url)',
    'globalThis.fetch(url)',
    'globalThis.fetch?.(url)',
    'window.fetch?.(url)',
    'fetch /* note */ (url)',
    'fetch // note\n (url)',
    'fetch/* a */?./* b */(url)',
    'fetch\n  (url)',
    "globalThis['fetch'](url)",
    'globalThis["fetch"]?.(url)',
    'globalThis[`fetch`](url)',
    'fetch.call(null, url)',
    'fetch.bind(globalThis)(url)',
    'const get = fetch; get(url)',
    'const { fetch: get } = globalThis',
    'const get = globalThis.fetch',
    'export const view = () => <a onClick={() => fetch(url)} />',
  ])('the network scan catches %j', (source) => {
    expect(fetchReferences(source)).not.toEqual([])
  })

  it.each([
    'const fetched = 1',
    'prefetch(url)',
    'fetchCases(url)',
    'refetch?.()',
    'const note = "call fetch(url) later"',
    'const note = `fetch(url)`',
    '// fetch(url) is not allowed here',
    '/* globalThis.fetch(url) */ const ok = 1',
    "globalThis['fetchCases'](url)",
    'client.fetchCases(url)',
  ])('the network scan leaves %j alone', (source) => {
    expect(fetchReferences(source)).toEqual([])
  })

  it('finds the console sources it is meant to scan', () => {
    expect(consoleSources.map((path) => relative(SRC, path))).toEqual(
      expect.arrayContaining([
        'app/moderation/page.tsx',
        'app/moderation/cases/[caseId]/page.tsx',
        'app/components/moderation-queue.tsx',
        'app/components/moderation-case-detail.tsx',
        'lib/moderation.ts',
      ])
    )
  })

  it.each(consoleSources.map((path) => [relative(SRC, path), path]))(
    '%s imports no database, Supabase or storage client and declares no server action',
    (_name, path) => {
      const code = readFileSync(path, 'utf8')
      const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1]!
      )
      for (const specifier of imports) {
        expect(specifier, `${_name} imports ${specifier}`).not.toMatch(
          /@supabase|supabase|@prisma|prisma|pg$|\/db$|@couture\/db|storage|web-session$/i
        )
        expect(specifier).not.toMatch(/^node:|^fs$/)
      }
      expect(code).not.toMatch(/['"]use server['"]/)
      expect(code).not.toMatch(
        /\.storage\b|\.from\(\s*['"][A-Z]|createClient\(|webSupabase\(/
      )
      expect(code).not.toMatch(
        /\b(CommunityPostReport|CommunityCommentReport|ModerationEvent|AuditLog|LookbookPost)\b/
      )
    }
  )

  it('reaches the API only through the generated SDK client', () => {
    const lib = readFileSync(join(SRC, 'lib', 'moderation.ts'), 'utf8')
    expect(lib).toMatch(/createWebApiClient/)
    expect(lib).toMatch(/listModerationCases/)
    expect(lib).toMatch(/getModerationCase/)
    // No console source reaches the network on its own.
    for (const path of consoleSources) {
      expect(fetchReferences(readFileSync(path, 'utf8')), relative(SRC, path)).toEqual([])
    }
  })
})
