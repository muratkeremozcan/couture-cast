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
function fetchReferences(source: string, fileName = 'scan.tsx'): string[] {
  // The extension picks the script kind, so a generic arrow in a .ts file is not read as JSX.
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const namesFetch = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteralLike(node) && node.text === 'fetch'
  const visit = (node: ts.Node) => {
    const isName = ts.isIdentifier(node) && node.text === 'fetch'
    const isLiteralKey =
      namesFetch(node) &&
      (ts.isElementAccessExpression(node.parent) ||
        ts.isComputedPropertyName(node.parent) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.propertyName === node))
    if (isName || isLiteralKey) found.push(node.getText(tree))
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
    "const { 'fetch': get } = globalThis",
    "const { ['fetch']: get } = globalThis",
    "const table = { 'fetch': 1 }",
    "const table = { ['fetch']: 1 }",
    'export const view = () => <a onClick={() => fetch(url)} />',
  ])('the network scan catches %j', (source) => {
    expect(fetchReferences(source)).not.toEqual([])
  })

  it('reads a .ts source as TypeScript and a .tsx source as JSX', () => {
    const generic = 'const wrap = <T>(value: T) => value\nconst call = () => fetch(url)'
    expect(fetchReferences(generic, 'queue.ts')).toEqual(['fetch'])
    expect(fetchReferences('const view = <a>fetch</a>', 'queue.tsx')).toEqual([])
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
    "const { 'fetchCases': get } = globalThis",
    "const note = { text: 'fetch' }",
    "const label = 'fetch'",
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

  // Story 6.12: a move out of these two folders would drop the SLA page from the scan unnoticed.
  it('U-WEB-NO-DIRECT: the SLA page and dashboard sit inside the scan', () => {
    expect(consoleSources.map((path) => relative(SRC, path))).toEqual(
      expect.arrayContaining([
        'app/moderation/sla/page.tsx',
        'app/components/moderation-sla-dashboard.tsx',
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
      expect(
        fetchReferences(readFileSync(path, 'utf8'), path),
        relative(SRC, path)
      ).toEqual([])
    }
  })
})
