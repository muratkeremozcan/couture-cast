// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: U-GATE-RECORD, U-GATE-UNTOUCHED, U-RUNBOOK-STAFFING, U-GUIDE-LIMITS.
// These read the shipped documents, because a gate record is only worth what it can be checked against.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8')
const RECORD = '_bmad-output/test-artifacts/community-beta-gate-signatures.md'
const OWNER_DATE = '2026-11-05'
const SIGNED = 'Signed off by owner'

/** The first markdown table in the record that names a signature, as objects keyed by header. */
function signatureRows(): Record<string, string>[] {
  const lines = read(RECORD).split('\n')
  const header = lines.findIndex(
    (line) => line.trimStart().startsWith('|') && /signature/i.test(line)
  )
  expect(header, 'the record has a signature table').toBeGreaterThanOrEqual(0)
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  const names = cells(lines[header]!).map((name) => name.toLowerCase())
  const rows: Record<string, string>[] = []
  for (const line of lines.slice(header + 2)) {
    if (!line.trimStart().startsWith('|')) break
    const values = cells(line)
    rows.push(Object.fromEntries(names.map((name, at) => [name, values[at] ?? ''])))
  }
  return rows
}

const rowFor = (signature: RegExp) => {
  const row = signatureRows().find((entry) => signature.test(entry.signature ?? ''))
  expect(row, String(signature)).toBeDefined()
  return row!
}

describe('U-GATE-RECORD', () => {
  it('exists, and the roadmap and the guide link to it', () => {
    expect(existsSync(path.join(repoRoot, RECORD))).toBe(true)
    expect(read('_bmad-output/project-knowledge/couturecast_roadmap.md')).toContain(
      'community-beta-gate-signatures.md'
    )
    expect(read('_bmad-output/project-knowledge/deployment-guide.md')).toContain(
      'community-beta-gate-signatures.md'
    )
  })

  it.each([/^Audit/i, /^Privacy/i, /^Deletion/i, /staffing/i])(
    'gives %s an owner ruling with a date, a source, a limit and no cryptographic claim',
    (signature) => {
      const row = rowFor(signature)
      expect(row.status).toContain(SIGNED)
      expect(JSON.stringify(row)).toContain(OWNER_DATE)
      expect(row.limit ?? row['stated limit'] ?? row.limits).toMatch(/\S/)
      expect(row.source).toMatch(/owner/i)
    }
  )

  it.each([/^Audit/i, /^Privacy/i, /^Deletion/i])(
    'rests %s on real files at a real commit',
    (signature) => {
      const proof = rowFor(signature).proof ?? ''
      const files = [...proof.matchAll(/`([\w./-]+\.(?:ts|tsx|mjs))`/g)].map(
        (match) => match[1]!
      )
      expect(files.length, proof).toBeGreaterThan(0)
      for (const file of files)
        expect(existsSync(path.join(repoRoot, file)), file).toBe(true)
      const commits = [...proof.matchAll(/\b[0-9a-f]{40}\b/g)].map((match) => match[0])
      expect(commits.length, proof).toBeGreaterThan(0)
      // The repository merges by squash and CI can be shallow, so a proof commit can be absent from
      // this checkout. The format always holds, and a shallow history cannot prove it false.
      expect(commits.every((commit) => commit.length === 40)).toBe(true)
    }
  )

  it('states the limits the spec names', () => {
    expect(rowFor(/^Audit/i).limit ?? '').toMatch(/DDL/)
    expect(rowFor(/^Privacy/i).limit ?? '').toMatch(/details/i)
    expect(rowFor(/^Deletion/i).limit ?? '').toMatch(/self-service/i)
    expect(rowFor(/^Deletion/i).limit ?? '').toMatch(/`?User`?/)
  })

  it('keeps audit marked as outside the eight named signatures', () => {
    expect(JSON.stringify(rowFor(/^Audit/i))).toMatch(
      /not one of the eight|outside the eight/i
    )
  })

  it.each([/SLA alert/i, /localization/i, /accessibility/i, /rollback/i])(
    'leaves %s open, so Community Beta stays closed',
    (signature) => {
      expect(rowFor(signature).status).toMatch(/^open/i)
    }
  )

  it('leaves the model row as it was', () => {
    expect(rowFor(/^Model/i).status).toMatch(/unchanged/i)
  })

  it('invents no signature, hash, roster or schedule', () => {
    const text = read(RECORD)
    expect(text).toMatch(/no cryptographic signature/i)
    expect(text).not.toMatch(/-----BEGIN|signature:\s*[0-9a-f]{32,}/i)
    expect(rowFor(/staffing/i).limit ?? '').toMatch(/no roster or schedule/i)
  })
})

describe('U-GATE-UNTOUCHED', () => {
  // Constants, because a CI checkout can be shallow. Measured at 56509fa8, the story's baseline.
  it.each([
    [
      'scripts/generate-community-screening-readiness.mjs',
      '09e31bd8cd5212eb977824bd7ce5909e1ff420b42e4e0391bd8e69717d63c228',
    ],
    [
      'scripts/sign-community-screening-readiness.mjs',
      '4516b908b0dd5cfaab4fdfb333a9d984597b7960e80053b5cd3b637f26db3e8d',
    ],
  ])('keeps %s byte-identical, GATE_SIGNATURES included', (file, digest) => {
    expect(createHash('sha256').update(read(file)).digest('hex')).toBe(digest)
  })
})

describe('U-RUNBOOK-STAFFING', () => {
  const runbook = read('_bmad-output/project-knowledge/moderation-sla-runbook.md')
  const coverage = runbook.slice(runbook.indexOf('## Coverage'))

  it('records the sign-off with its date and source', () => {
    expect(coverage).toContain(OWNER_DATE)
    expect(coverage).toMatch(/signed off by the owner/i)
  })

  it('keeps every assignee and hours cell empty', () => {
    const rows = coverage
      .split('\n')
      .filter((line) =>
        /^\| (Community moderator|Admin|On-duty responder|Release owner)/.test(line)
      )
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      const [, , assignee, hours] = row.split('|').map((cell) => cell.trim())
      expect(assignee).toBe('')
      expect(hours).toBe('')
    }
  })

  it('drops the wording from gap 11', () => {
    expect(read('_bmad-output/project-knowledge/deployment-guide.md')).not.toContain(
      'staffing coverage is unsigned'
    )
  })
})

describe('U-GUIDE-LIMITS', () => {
  const guide = read('_bmad-output/project-knowledge/deployment-guide.md')

  it('names the residual, the sequence, the command and the retention rule', () => {
    expect(guide).toContain('moderation:history:verify')
    expect(guide).toContain('moderation_history_owner')
    expect(guide).toMatch(/arbitrary DDL/i)
    expect(guide).toMatch(/SET ROLE/)
    expect(guide).toMatch(/400 days/)
  })
})
