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
const WAIVER_DATE = '2026-11-19'

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
      // The commit's existence is not checked here: the repository merges by squash and CI can be
      // shallow, so a true proof commit can be absent from any later checkout. M-GATE-READ checked it.
      expect(commits.length, proof).toBeGreaterThan(0)
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

  // Owner ruling 2026-11-19: the owner authorized opening the Community Beta to every member
  // before these five rows were signed. That is an authorization recorded here, not evidence of
  // a rollout: the record makes the 100 percent flag change conditional on a later deploy.
  // This table is a historical snapshot, so its rows are pinned by exact text. A waived row must
  // keep the work that was still outstanding when it was waived, name the dated ruling it rests
  // on, and never sit beside a second row for the same signature that claims a sign-off.
  const WAIVER_SOURCE =
    "The owner's ruling of 2026-11-19, relayed by the coordinator: open the Community Beta to every member now"
  /** Signature, then the proof and the limit as recorded on the day of the waiver. */
  const WAIVED: [RegExp, string, string][] = [
    [
      /^Model$/,
      'The readiness verdict is fail (2026-10-17: safe photo withheld upper bound 0.1286 above 0.05; clean-copy holdout withheld in es, fr, it and pt). The same ruling asks for the screening to be retuned on the measured holdouts without lowering the unsafe catch rate; that change records its own before and after numbers',
      'Launched without a passing readiness payload; no `npm run community:screening:sign` approval exists',
    ],
    [
      /^SLA alerts$/,
      "Story 6.12's SLA sweep and console banner; the owner ruled SLA alerts console-only for now",
      'No production webhook destination: `MODERATION_OPS_WEBHOOK_URL` stays unset, so a breach shows only on `/moderation/sla`',
    ],
    [
      /^Localization$/,
      'Community copy ships in all 10 web and mobile catalogs',
      'No localization review was recorded against this gate',
    ],
    [
      /^Accessibility$/,
      'The community accessibility tests listed in the learning path Steps 38 to 58',
      'No accessibility sign-off was recorded against this gate',
    ],
    [
      /^Rollback$/,
      'The rollback steps in `_bmad-output/project-knowledge/deployment-guide.md`: turn the PostHog flags off, plus `complimentary_access_enabled` for grantees, and redeploy or stop the worker',
      'No automated rollback exists, and no rollback drill was run',
    ],
  ]

  it('lists each of the nine signatures exactly once', () => {
    const names = signatureRows().map((row) => row.signature ?? '')
    expect(names).toEqual([
      'Audit (not one of the eight named signatures; AC 3 of CC-6.13 names it)',
      'Privacy',
      'Deletion',
      'Moderation staffing',
      'Model',
      'SLA alerts',
      'Localization',
      'Accessibility',
      'Rollback',
    ])
  })

  it.each(WAIVED)(
    'records %s as waived by the dated owner ruling, with its proof and outstanding limit kept',
    (signature, proof, limit) => {
      const row = rowFor(signature)
      expect(row.status).toBe('Waived by owner')
      expect(row.date).toBe(WAIVER_DATE)
      expect(row.source).toBe(WAIVER_SOURCE)
      // The proof says what existed, not that the gate passed: the Model row keeps the failed
      // readiness verdict, and no waived row may claim a review or approval it never had.
      expect(row.proof).toBe(proof)
      expect(row.limit).toBe(limit)
    }
  )

  it('says a waiver is not a signature', () => {
    expect(read(RECORD)).toMatch(/A waiver is not a signature/)
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
