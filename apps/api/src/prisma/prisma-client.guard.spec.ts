import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The pldbgapi2 retry is central: prisma-client.ts owns the only production client
// constructor (top-level retry extension) and the only `$transaction` call (the
// interactive-transaction helper). Any other call in product code would bypass both.
const app = resolve(__dirname, '../..')
const owner = 'src/prisma/prisma-client.ts'
const forbidden = [
  { name: '$transaction call', pattern: /\.\s*\$transaction\s*(?:<[^>]*>)?\s*\(/g },
  { name: 'PrismaClient construction', pattern: /\bnew\s+PrismaClient\s*\(/g },
]

function productFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : productFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

describe('central Prisma retry guard', () => {
  const files = ['src', 'api'].flatMap((root) => productFiles(join(app, root)))

  it('scans the product sources, including the owner', () => {
    const paths = files.map((file) => relative(app, file))
    expect(paths).toContain(owner)
    expect(paths).toContain('api/realtime.ts')
    expect(paths).toContain('src/modules/guardian/guardian.service.ts')
    expect(paths).not.toContain('src/testing/prisma-mock.ts')
  })

  it.each(forbidden)('finds no $name outside prisma-client.ts', ({ pattern }) => {
    const offenders = files
      .filter((file) => relative(app, file) !== owner)
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(pattern)].map(
          (match) => `${relative(app, file)}: ${match[0]}`
        )
      )
    expect(offenders).toEqual([])
  })

  it('pins the single-run transactions to the reviewed callers', () => {
    // Each runs an effect a rollback cannot undo before commit and writes no table
    // whose triggers run nested PL/pgSQL. A new caller needs the same review.
    const callers = files
      .filter((file) => relative(app, file) !== owner)
      .filter((file) => /\bsingleRunTransaction\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(app, file))
      .sort()
    expect(callers).toEqual([
      'src/modules/community/community-comments.outbox.ts',
      'src/modules/community/community-send-guard.ts',
      'src/modules/telemetry/telemetry.service.ts',
    ])
  })
})
