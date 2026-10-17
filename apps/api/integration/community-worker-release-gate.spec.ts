// Story 6.2b: static and pure-function checks for the community worker release
// gate. The scripts under test are operations commands; what is asserted here is
// the logic that decides whether they refuse, so a regression in a refusal
// fails the ordinary suite instead of a deploy.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

interface CanaryModule {
  assertTargetMatchesDatabase: (target: string, url: string | undefined) => string
  assessTerminalPost: (post: Record<string, unknown>) => {
    disposition: string
    engineIdentity: string
  }
  CanaryFailure: new (...args: unknown[]) => Error & { code: string }
}
interface LauncherModule {
  resolveStartableSelector: (env: Record<string, string>) => {
    ok: boolean
    selector?: string
    reason?: string
  }
}
interface SignModule {
  signingRefusal: (context: {
    stdinIsTTY: boolean
    stdoutIsTTY: boolean
    env: Record<string, string>
    delegated?: boolean
  }) => string | null
  delegatedSignature: (
    payload: Record<string, unknown>,
    digest: string,
    now?: Date
  ) => { refusal?: string; record?: Record<string, unknown> }
  assessSignature: (
    payload: Buffer | null,
    signature: Record<string, unknown> | null
  ) => { status: string }
  payloadDigest: (bytes: Buffer) => string
}
interface CorpusModule {
  verifyManifest: (
    manifest: Record<string, unknown> | null,
    store: string
  ) => { problems: string[] }
  MINIMUM_COUNT: number
}
interface ListsModule {
  unindexableReason: (literal: string, allowSingles: Set<string>) => string | null
}

async function load<T>(relative: string): Promise<T> {
  return (await import(path.join(repoRoot, relative))) as T
}

const REAL_IDENTITY =
  'adr013-text:policy-v1@abc;adr013-nsfw-v1.0:mobilenet_v2_mid@4.3.0:model-1:v1:policy-1'

describe('community worker image', () => {
  const dockerfile = read('apps/api/Dockerfile.community-worker')

  it('runs as the unprivileged node user under tini', () => {
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "-s", "--"\]$/m)
    expect(dockerfile).toMatch(
      /^CMD \["node", "scripts\/start-community-worker-production\.mjs"\]$/m
    )
  })

  it('fails the build past the free-tier dependency budget and self-tests the model', () => {
    expect(dockerfile).toContain('--max-node-modules-mb 150')
    expect(dockerfile).toMatch(
      /RUN COMMUNITY_NSFW_SCREENER=tensorflow node .*--self-test/
    )
  })

  it('bakes no screener selector into the image', () => {
    const envLines = dockerfile
      .split('\n')
      .filter((line) => /^\s*(ENV|\s+[A-Z_]+=)/.test(line))
    expect(envLines.join('\n')).not.toMatch(/COMMUNITY_NSFW_SCREENER=/)
  })

  it('keeps env files and installed trees out of the build context', () => {
    const ignore = read('.dockerignore')
    expect(ignore).toMatch(/^\.env\.\*$/m)
    expect(ignore).toMatch(/^!\.env\.example$/m)
    expect(ignore).toMatch(/^\*\*\/node_modules$/m)
  })
})

describe('production launcher selector', () => {
  it('refuses an unset, unknown or fixture selector and accepts the real and degraded ones', async () => {
    const { resolveStartableSelector } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    expect(resolveStartableSelector({}).ok).toBe(false)
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'fixture' }).ok).toBe(
      false
    )
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'onnx' }).ok).toBe(false)
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'tensorflow' })).toEqual({
      ok: true,
      selector: 'tensorflow',
    })
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'unavailable' }).ok).toBe(
      true
    )
  })
})

describe('canary refusals', () => {
  it('refuses a target label that disagrees with the database host', async () => {
    const { assertTargetMatchesDatabase } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(() =>
      assertTargetMatchesDatabase(
        'local',
        'postgresql://u:p@db.example.supabase.co:5432/postgres'
      )
    ).toThrow(/non-local/)
    expect(() =>
      assertTargetMatchesDatabase('hosted', 'postgresql://u:p@127.0.0.1:54322/postgres')
    ).toThrow(/local database/)
    expect(() => assertTargetMatchesDatabase('local', undefined)).toThrow(/DATABASE_URL/)
    expect(
      assertTargetMatchesDatabase('local', 'postgresql://u:p@127.0.0.1:54322/postgres')
    ).toBe('127.0.0.1')
  })

  it('fails on a fixture or degraded identity and on a withheld safe fixture', async () => {
    const { assessTerminalPost } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    const codeOf = (post: Record<string, unknown>) => {
      try {
        assessTerminalPost(post)
        return 'passed'
      } catch (error) {
        return (error as { code: string }).code
      }
    }
    expect(
      codeOf({
        status: 'published',
        moderation_engine_version: 'adr013-text-v2.0-fixture;x',
      })
    ).toBe('not_a_real_model')
    expect(
      codeOf({
        status: 'flagged',
        moderation_engine_version: 'adr013-text:p;adr013-nsfw-unavailable',
      })
    ).toBe('not_a_real_model')
    expect(codeOf({ status: 'published', moderation_engine_version: null })).toBe(
      'identity_missing'
    )
    expect(codeOf({ status: 'flagged', moderation_engine_version: REAL_IDENTITY })).toBe(
      'safe_fixture_withheld'
    )
    expect(
      assessTerminalPost({
        status: 'published',
        moderation_engine_version: REAL_IDENTITY,
      })
    ).toEqual({ disposition: 'pass', engineIdentity: REAL_IDENTITY })
  })
})

describe('owner signature', () => {
  it('reports unsigned, valid and stale against the payload bytes', async () => {
    const { assessSignature, payloadDigest } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const payload = Buffer.from('{"verdict":"pass"}\n')
    const signature = { payloadSha256: payloadDigest(payload), ownerVerdict: 'approved' }
    expect(assessSignature(null, null).status).toBe('missing-payload')
    expect(assessSignature(payload, null).status).toBe('unsigned')
    expect(assessSignature(payload, signature).status).toBe('valid')
    expect(assessSignature(Buffer.from('{"verdict":"pass"} \n'), signature).status).toBe(
      'stale'
    )
  })

  it('refuses to sign without a terminal, under CI, or inside a coding-agent session', async () => {
    const { signingRefusal } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const tty = { stdinIsTTY: true, stdoutIsTTY: true }
    expect(signingRefusal({ ...tty, stdinIsTTY: false, env: {} })).toMatch(
      /interactive terminal/
    )
    expect(signingRefusal({ ...tty, env: { CI: 'true' } })).toMatch(/CI set/)
    expect(signingRefusal({ ...tty, env: { CLAUDECODE: '1' } })).toMatch(/CLAUDECODE set/)
    expect(signingRefusal({ ...tty, env: {} })).toBeNull()
  })

  it('allows delegated signing from an agent session but never under CI', async () => {
    const { signingRefusal } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const piped = { stdinIsTTY: false, stdoutIsTTY: false, delegated: true }
    expect(signingRefusal({ ...piped, env: { CLAUDECODE: '1' } })).toBeNull()
    expect(signingRefusal({ ...piped, env: { CI: 'true' } })).toMatch(/CI set/)
    expect(signingRefusal({ ...piped, env: { GITHUB_ACTIONS: 'true' } })).toMatch(
      /GITHUB_ACTIONS set/
    )
  })

  it('records a delegated approval only for a passing payload, with no quoted text', async () => {
    const { delegatedSignature } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    expect(delegatedSignature({ verdict: 'fail' }, 'a'.repeat(64)).refusal).toMatch(
      /verdict is fail/
    )
    expect(
      delegatedSignature({ verdict: 'incomplete' }, 'a'.repeat(64)).record
    ).toBeUndefined()
    const { record } = delegatedSignature(
      { verdict: 'pass', generatedAt: '2026-10-16T00:00:00.000Z' },
      'b'.repeat(64),
      new Date('2026-10-17T00:00:00.000Z')
    )
    expect(record).toEqual({
      artifact: 'community-content-screening-signature',
      gate: 'Community Beta model readiness',
      mode: 'delegated-by-owner',
      payloadPath:
        '_bmad-output/test-artifacts/community-content-screening-model-readiness.json',
      payloadSha256: 'b'.repeat(64),
      payloadVerdict: 'pass',
      payloadGeneratedAt: '2026-10-16T00:00:00.000Z',
      ownerVerdict: 'approved',
      signedAt: '2026-10-17T00:00:00.000Z',
    })
  })
})

describe('safe corpus manifest checks', () => {
  it('refuses a missing, short, non-commercial or duplicated corpus', async () => {
    const { verifyManifest, MINIMUM_COUNT } = await load<CorpusModule>(
      'scripts/fetch-community-safe-corpus.mjs'
    )
    const store = path.join(repoRoot, 'apps/api/.cache/no-such-store')
    const entry = (id: string, license: string, sha: string) => ({
      id,
      source: 'flickr',
      license,
      url: `https://example.invalid/${id}.jpg`,
      sha256: sha.repeat(64),
      file: `${id}.jpg`,
    })
    expect(verifyManifest(null, store).problems.length).toBeGreaterThan(0)
    const short = verifyManifest(
      { corpusId: 'community-safe-photographs-v1', entries: [entry('a', 'by', 'a')] },
      store
    )
    expect(short.problems.join(' ')).toMatch(
      new RegExp(`below the minimum of ${MINIMUM_COUNT}`)
    )
    const bad = verifyManifest(
      {
        corpusId: 'community-safe-photographs-v1',
        entries: [entry('a', 'by-nc', 'a'), entry('b', 'by', 'a')],
      },
      store
    )
    expect(bad.problems.join(' ')).toMatch(/does not permit commercial use/)
    expect(bad.problems.join(' ')).toMatch(/duplicates the bytes/)
  })
})

describe('term list generation', () => {
  it('drops what the screener cannot index unless the allow list makes it indexable', async () => {
    const { unindexableReason } = await load<ListsModule>(
      'scripts/verify-community-screening-lists.mjs'
    )
    expect(unindexableReason('\u{1F595}', new Set())).toMatch(/no letters/)
    expect(unindexableReason('ass', new Set())).toMatch(/single-term floor/)
    expect(unindexableReason('kys', new Set())).toBeNull()
    expect(unindexableReason('jizz', new Set())).toMatch(/collapses to "jiz"/)
    expect(unindexableReason('jizz', new Set(['jiz']))).toBeNull()
    expect(unindexableReason('two girls one cup', new Set())).toBeNull()
  })
})

interface CalibrationModule {
  UNSAFE_BOUNDS: Record<string, number>
  dispositionUnder: (
    variant: Record<string, unknown>,
    p: Record<string, number>
  ) => string
  chooseConfiguration: (
    byFamily: Record<
      string,
      { id: string; withheldRate: number; kind: string; safeMassMinimum?: number }[]
    >,
    fits: (family: string) => boolean
  ) => { family: string; id: string } | undefined
}

describe('model calibration', () => {
  const vector = (p: Partial<Record<string, number>>) => ({
    Drawing: 0,
    Hentai: 0,
    Neutral: 0,
    Porn: 0,
    Sexy: 0,
    ...p,
  })

  it('holds every unsafe bound at its original value in every variant', async () => {
    const { UNSAFE_BOUNDS, dispositionUnder } = await load<CalibrationModule>(
      'scripts/calibrate-community-screening-models.mjs'
    )
    expect(UNSAFE_BOUNDS).toEqual({
      blockMinimum: 0.35,
      unsafeAggregateMaximum: 0.1,
      sexyPassMaximum: 0.15,
      jointMaximum: 0.15,
    })
    const loose = { kind: 'safe-mass', safeMassMinimum: 0.5 }
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.5, Neutral: 0.3, Porn: 0.36 }))
    ).toBe('block')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.8, Hentai: 0.05, Porn: 0.05 }))
    ).toBe('review')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.7, Neutral: 0.15, Sexy: 0.15 }))
    ).toBe('review')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.7, Neutral: 0.2, Sexy: 0.1 }))
    ).toBe('pass')
    // Each class inside its own bound, together at the joint ceiling.
    expect(
      dispositionUnder(
        loose,
        vector({ Drawing: 0.85, Hentai: 0.04, Porn: 0.04, Sexy: 0.07 })
      )
    ).toBe('review')
    expect(
      dispositionUnder({ kind: 'current' }, vector({ Drawing: 0.9, Neutral: 0.1 }))
    ).toBe('review')
  })

  it('picks the lowest withheld rate among fitting families, ties to the stricter value', async () => {
    const { chooseConfiguration } = await load<CalibrationModule>(
      'scripts/calibrate-community-screening-models.mjs'
    )
    const variant = (id: string, safeMassMinimum: number, withheldRate: number) => ({
      id,
      kind: 'safe-mass',
      safeMassMinimum,
      withheldRate,
    })
    const chosen = chooseConfiguration(
      {
        mobilenet_v2: [variant('a', 0.8, 0.1)],
        mobilenet_v2_mid: [variant('b', 0.8, 0.2), variant('c', 0.75, 0.2)],
        inception_v3: [variant('d', 0.8, 0.05)],
      },
      (family) => family !== 'inception_v3' && family !== 'mobilenet_v2'
    )
    expect(chosen).toMatchObject({ family: 'mobilenet_v2_mid', id: 'b' })
  })
})

describe('committed corpora and lists, checked in the ordinary suite', () => {
  it('keeps every vendored and generated list identical to what its sources produce', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/verify-community-screening-lists.mjs'), '--json'],
      { cwd: repoRoot, encoding: 'utf8' }
    )
    const report = JSON.parse(output) as { status: string; problems: string[] }
    expect(report.problems).toEqual([])
    expect(report.status).toBe('verified')
  })

  it('licenses every committed safe-corpus photograph for commercial use', async () => {
    const { verifyManifest } = await load<CorpusModule>(
      'scripts/fetch-community-safe-corpus.mjs'
    )
    const manifest = JSON.parse(
      read('apps/api/test/fixtures/community-safe-corpus/manifest.json')
    ) as Record<string, unknown>
    // An absent store checks the manifest alone: licences, hashes, duplicates,
    // the creator cap, the split and the minimum count.
    const result = verifyManifest(
      manifest,
      path.join(repoRoot, 'apps/api/.cache/no-such-store')
    )
    expect(result.problems).toEqual([])
  })
})

interface RegressionGateModule {
  assessRuntimeAgainstGates: (
    report: Record<string, unknown>,
    performance: Record<string, unknown>
  ) => { ok: boolean; failures: string[] }
}

/**
 * Story 6.2 Task 6: a runtime measurement above the committed regression gate
 * or an absolute ceiling must fail the command, not just appear in a report.
 */
type GatedMetric = 'coldStartupMs' | 'warmP95Ms' | 'warmP99Ms' | 'peakResidentMib'

describe('runtime regression gate', () => {
  const manifestPath = path.join(
    repoRoot,
    'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
  )
  const performance = (
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      performance: {
        regressionGate: Record<GatedMetric, number>
        absoluteCeilings: Record<GatedMetric, number>
      }
    }
  ).performance
  const gate = performance.regressionGate

  /** A report exactly at every regression gate, which must still pass. */
  const atGate = () => ({
    warmSamples: 1000,
    coldStartupMs: gate.coldStartupMs,
    warmSupervisedMs: { p95: gate.warmP95Ms, p99: gate.warmP99Ms },
    peakResidentMib: gate.peakResidentMib,
  })

  function runGate(report: Record<string, unknown>) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-gate-'))
    const reportPath = path.join(directory, 'runtime.json')
    fs.writeFileSync(reportPath, JSON.stringify(report))
    try {
      return spawnSync(
        process.execPath,
        [
          path.join(repoRoot, 'scripts/check-community-worker-regression-gate.mjs'),
          reportPath,
        ],
        { cwd: repoRoot, encoding: 'utf8' }
      )
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }

  it('commits a gate for every metric it checks, never above its ceiling', () => {
    const metrics: GatedMetric[] = [
      'coldStartupMs',
      'warmP95Ms',
      'warmP99Ms',
      'peakResidentMib',
    ]
    for (const key of metrics) {
      expect(gate[key]).toBeGreaterThan(0)
      expect(gate[key]).toBeLessThanOrEqual(performance.absoluteCeilings[key])
    }
  })

  it('exits 0 for a run at the gate and 1 for a run one step past it', () => {
    const passing = runGate(atGate())
    expect(passing.status, passing.stderr).toBe(0)

    const slow = runGate({
      ...atGate(),
      warmSupervisedMs: { p95: gate.warmP95Ms + 0.01, p99: gate.warmP99Ms },
    })
    expect(slow.status).toBe(1)
    expect(slow.stderr).toMatch(/warmP95Ms .* above the regression gate/)
  })

  it.each([
    ['cold startup past its gate', { coldStartupMs: gate.coldStartupMs + 1 }],
    ['warm p99 past its gate', { warmSupervisedMs: { p95: 1, p99: gate.warmP99Ms + 1 } }],
    ['peak RSS past the memory ceiling', { peakResidentMib: gate.peakResidentMib + 1 }],
    ['a missing measurement', { peakResidentMib: undefined }],
    ['no warm samples', { warmSamples: 0 }],
  ])('fails on %s', async (_label, patch) => {
    const { assessRuntimeAgainstGates } = await load<RegressionGateModule>(
      'scripts/check-community-worker-regression-gate.mjs'
    )
    const verdict = assessRuntimeAgainstGates({ ...atGate(), ...patch }, performance)
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.length).toBeGreaterThan(0)
  })

  it('fails when the manifest drops a gate, so a deleted limit cannot pass silently', async () => {
    const { assessRuntimeAgainstGates } = await load<RegressionGateModule>(
      'scripts/check-community-worker-regression-gate.mjs'
    )
    const withoutP95 = Object.fromEntries(
      Object.entries(gate).filter(([key]) => key !== 'warmP95Ms')
    )
    const verdict = assessRuntimeAgainstGates(atGate(), {
      ...performance,
      regressionGate: withoutP95,
    })
    expect(verdict.failures).toContain(
      'the manifest has no regression gate for warmP95Ms'
    )
  })
})

interface Gate {
  id: string
  status: 'passed' | 'failed' | 'not-run'
  problems?: string[]
}
interface GeneratorModule {
  buildGates: (sections: Record<string, unknown>) => Gate[]
  verdictOf: (gates: Gate[]) => string
  wilsonInterval: (successes: number, trials: number) => [number, number]
  inputStaleness: (recorded: unknown, current: string) => string[]
  TEXT_LANGUAGES: string[]
}

/** One change to the passing sections: a dotted path and its new value (undefined deletes). */
type Patch = [path: string, value: unknown]

function applyPatch(target: Record<string, unknown>, [dotted, value]: Patch) {
  const keys = dotted.split('.')
  const last = keys.pop() as string
  let node = target
  for (const key of keys) node = node[key] as Record<string, unknown>
  if (value === undefined) delete node[last]
  else node[last] = value
}

/**
 * Story 6.2b review (VG2): the release verdict, which a delegated signature
 * trusts, must fail closed. Sections are built in memory so every branch is
 * reached without Docker, Redis or the model.
 */
describe('readiness verdict', () => {
  const generator = () =>
    load<GeneratorModule>('scripts/generate-community-screening-readiness.mjs')

  async function passingSections(): Promise<Record<string, unknown>> {
    const { wilsonInterval, TEXT_LANGUAGES } = await generator()
    const canary = (target: string) => ({
      available: true,
      stale: [],
      ok: true,
      target,
      disposition: 'pass',
      engineIdentity: REAL_IDENTITY,
      expectedSha: 'abc123',
      processedBy: 'community-worker@abc123',
      timings: { queueLatencyMs: 3, screeningDurationMs: 190 },
    })
    const clean = () => ({
      total: 420,
      withheld: 0,
      recomputedUpperBound: wilsonInterval(0, 420)[1],
      expectedReviewIds: [],
      expectedReviewThatPassed: [],
    })
    return {
      workingTree: { clean: true, changedPaths: 0, sample: [] },
      image: {
        available: true,
        stale: [],
        nodeModulesMb: 112,
        user: 'node',
        entrypoint: ['/usr/bin/tini', '--'],
        commitSha: 'abc123',
      },
      canaries: {
        local: canary('local'),
        restart: canary('local'),
        hosted: canary('hosted'),
      },
      sweep: {
        available: true,
        stale: [],
        sweep: {
          vectorCount: 100,
          oracleDisagreements: 0,
          passAtOrAboveAReviewThreshold: 0,
        },
        coverage: {
          functions: [{ functionName: 'disposition', blocks: 9, uncoveredBlocks: 0 }],
        },
      },
      calibration: {
        available: true,
        stale: [],
        calibrationEntries: 300,
        chosen: {
          family: 'mobilenet_v2_mid',
          id: 'safe-mass@0.8',
          safeMassMinimum: 0.8,
          withheldRate: 0.1,
        },
        shipped: {
          family: 'mobilenet_v2_mid',
          safeMassMinimum: 0.8,
          bounds: { blockMinimum: 0.35, jointMaximum: 0.15 },
        },
        unsafeBounds: { blockMinimum: 0.35, jointMaximum: 0.15 },
      },
      safeCorpus: {
        available: true,
        stale: [],
        split: 'holdout',
        evaluated: 300,
        validationRejected: [],
        holdoutEntries: 300,
        manifest: { holdoutEntries: 300 },
        counts: { pass: 300, review: 0, block: 0 },
        withheld: 0,
        withheldRate: 0,
        recomputedWilson95: wilsonInterval(0, 300),
        triageMissing: [],
      },
      text: {
        available: true,
        stale: [],
        missingLanguages: [],
        languages: Object.fromEntries(
          TEXT_LANGUAGES.map((language) => [
            language,
            {
              clean: clean(),
              cleanInSample: clean(),
              disallowed: { total: 100, bypassIds: [] },
            },
          ])
        ),
      },
      lists: {
        verification: { status: 'verified', problems: [] },
        allowList: { everyEntryHasReason: true },
      },
      model: { status: 'verified', failures: [] },
      runtime: {
        ceilings: {
          coldStartupMs: 30000,
          warmP95Ms: 3000,
          warmP99Ms: 5000,
          peakResidentMib: 512,
        },
        latency: {
          available: true,
          stale: [],
          warmSamples: 1000,
          coldStartupMs: 2400,
          warmSupervisedMs: { p95: 300, p99: 400 },
        },
        memory: {
          available: true,
          stale: [],
          canaryOk: true,
          upload: { name: 'generated-4096x4096.jpg' },
          memoryLimitMib: 512,
          memoryPeakMib: 300,
        },
      },
      redis: {
        available: true,
        stale: [],
        budgetShare: 0.5,
        projectedMonthly: { total: 150000, shareOfFreeTier: 0.3 },
        idle: { commandsPerHour: 138 },
        perPost: { commandsPerPost: 82 },
      },
      rollout: { communityReadEnabled: false, communityWriteEnabled: false },
    }
  }

  async function verdictAfter(patches: Patch[]) {
    const { buildGates, verdictOf } = await generator()
    const sections = await passingSections()
    for (const patch of patches) applyPatch(sections, patch)
    const gates = buildGates(sections)
    return { verdict: verdictOf(gates), gates }
  }

  const statusOf = (gates: Gate[], id: string) =>
    gates.find((entry) => entry.id === id)?.status
  const notRun = { available: false, stale: [] }

  it('passes only when every gate ran against current inputs and passed', async () => {
    const { verdict, gates } = await verdictAfter([])
    expect(gates.filter((entry) => entry.status !== 'passed')).toEqual([])
    expect(verdict).toBe('pass')
  })

  it('fails when any gate that ran failed, even beside a gate that did not run', async () => {
    const { verdict } = await verdictAfter([
      ['model.status', 'failed'],
      ['canaries.hosted', notRun],
    ])
    expect(verdict).toBe('fail')
  })

  it.each<[string, Patch[]]>([
    ['a gate that has not run', [['canaries.hosted', notRun]]],
    [
      'a dirty working tree',
      [['workingTree', { clean: false, changedPaths: 3, sample: ['a'] }]],
    ],
    [
      'a stale run product',
      [['safeCorpus.stale', ['inputs changed since the measurement']]],
    ],
    [
      'an image built from other inputs',
      [['image.stale', ['no input-set hash recorded']]],
    ],
    [
      'an undescribed withheld photograph',
      [['safeCorpus.triageMissing', ['openverse-1']]],
    ],
  ])('is incomplete with %s', async (_label, patches) => {
    const { verdict } = await verdictAfter(patches)
    expect(verdict).toBe('incomplete')
  })

  it.each<[string, string, Patch[]]>([
    [
      'an upper bound of 0.0501',
      'safe-corpus',
      [['safeCorpus.recomputedWilson95', [0.03, 0.0501]]],
    ],
    [
      'fewer than 250 holdout photographs',
      'safe-corpus',
      [
        ['safeCorpus.evaluated', 249],
        ['safeCorpus.holdoutEntries', 249],
        ['safeCorpus.manifest.holdoutEntries', 249],
      ],
    ],
    ['a partial holdout run', 'safe-corpus', [['safeCorpus.evaluated', 280]]],
    [
      'a holdout count unlike the manifest',
      'safe-corpus',
      [['safeCorpus.manifest.holdoutEntries', 310]],
    ],
    ['a blocked safe photograph', 'safe-corpus', [['safeCorpus.counts.block', 1]]],
    [
      'a missing text language',
      'text-clean-copy',
      [
        ['text.languages.tr', undefined],
        ['text.missingLanguages', ['tr']],
      ],
    ],
    [
      'a withheld holdout caption',
      'text-clean-copy',
      [
        ['text.languages.fr.clean.withheld', 1],
        ['text.languages.fr.clean.recomputedUpperBound', 0.0133],
      ],
    ],
    [
      'an obfuscation bypass',
      'text-obfuscation',
      [['text.languages.de.disallowed.bypassIds', ['de-x-1']]],
    ],
    [
      'a hosted gate fed a local canary',
      'canary-hosted',
      [['canaries.hosted.target', 'local']],
    ],
    [
      'a job processed by another build',
      'canary-hosted',
      [['canaries.hosted.processedBy', 'community-worker@zzz']],
    ],
    [
      'a fixture identity',
      'canary-local-container',
      [['canaries.local.engineIdentity', 'adr013-nsfw-fixture']],
    ],
    [
      'a calibration that chose another floor',
      'model-calibration',
      [['calibration.chosen.safeMassMinimum', 0.75]],
    ],
    [
      'a calibration run under other bounds',
      'model-calibration',
      [['calibration.unsafeBounds.jointMaximum', 0.2]],
    ],
    [
      'a null warm percentile',
      'runtime-latency',
      [['runtime.latency.warmSupervisedMs.p95', null]],
    ],
    ['zero warm samples', 'runtime-latency', [['runtime.latency.warmSamples', 0]]],
    ['missing ceilings', 'runtime-latency', [['runtime.ceilings', null]]],
    [
      'a memory peak from a small upload',
      'runtime-memory',
      [['runtime.memory.upload.name', 'safe-satin-plum-512x512.jpg']],
    ],
    [
      'a memory peak above the ceiling',
      'runtime-memory',
      [['runtime.memory.memoryPeakMib', 513]],
    ],
    [
      'a sweep with an oracle disagreement',
      'policy-surface',
      [['sweep.sweep.oracleDisagreements', 1]],
    ],
    [
      'a sweep that recorded no count',
      'policy-surface',
      [['sweep.sweep.passAtOrAboveAReviewThreshold', undefined]],
    ],
    ['a Redis count that is missing', 'redis-budget', [['redis.projectedMonthly', null]]],
  ])('fails on %s', async (_label, gateId, patches) => {
    const { verdict, gates } = await verdictAfter(patches)
    expect(statusOf(gates, gateId)).toBe('failed')
    expect(verdict).toBe('fail')
  })

  it('computes the Wilson interval to published reference values', async () => {
    const { wilsonInterval } = await generator()
    const [low, high] = wilsonInterval(0, 200)
    expect(low).toBeCloseTo(0, 12)
    expect(high).toBeCloseTo(0.01884, 4)
    const [low2, high2] = wilsonInterval(10, 100)
    expect(low2).toBeCloseTo(0.05523, 4)
    expect(high2).toBeCloseTo(0.17437, 4)
    expect(wilsonInterval(0, 0)).toEqual([0, 1])
  })

  it('treats a product without a current input-set hash as stale', async () => {
    const { inputStaleness } = await generator()
    expect(inputStaleness('a'.repeat(64), 'a'.repeat(64))).toEqual([])
    expect(inputStaleness('b'.repeat(64), 'a'.repeat(64))).toHaveLength(1)
    expect(inputStaleness(undefined, 'a'.repeat(64))).toHaveLength(1)
    expect(inputStaleness('unset', 'a'.repeat(64))).toHaveLength(1)
  })
})
