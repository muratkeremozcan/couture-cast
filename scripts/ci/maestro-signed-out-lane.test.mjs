// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 (TEA-8): guest preview flows run in their own signed-out shard of
// pr-mobile-e2e.yml, so the member shards keep their token bundle and a guest flow sees a
// true first launch. The resolver runs from a copy whose maestro/ holds guest flows,
// because the repository's flow set changes under it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { matrixRows } from './workflow-step-shadowing.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflow = parse(
  fs.readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
)
const job = workflow.jobs['mobile-e2e-android']
const step = (name) => job.steps.find((row) => row.name === name)

const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-signed-out-lane-'))
after(() => fs.rmSync(tree, { recursive: true, force: true }))
for (const file of [
  'scripts/resolve-maestro-shard.mjs',
  'scripts/maestro-flow-durations.json',
  'scripts/lib/native-maestro-flows.mjs',
  'scripts/lib/maestro-auth-mode.mjs',
]) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true })
  fs.copyFileSync(path.join(root, file), path.join(tree, file))
}
const memberFlows = ['analytics.yaml', 'commerce-affiliate.yaml', 'sanity.yaml']
const guestFlows = ['guest-preview-conversion.yaml', 'guest-preview.yaml']
fs.mkdirSync(path.join(tree, 'maestro/subflows'), { recursive: true })
for (const name of [
  ...memberFlows,
  ...guestFlows,
  'share-card-export.yaml',
  'config.yaml',
])
  fs.writeFileSync(path.join(tree, 'maestro', name), '- launchApp\n')
fs.writeFileSync(
  path.join(tree, 'maestro/subflows/guest-preview-open.yaml'),
  '- tapOn: x\n'
)

const resolve = (...args) => {
  const result = spawnSync(
    process.execPath,
    ['scripts/resolve-maestro-shard.mjs', ...args],
    { cwd: tree, encoding: 'utf8' }
  )
  const list = /^list=(.*)$/m.exec(result.stdout)?.[1].split(' ') ?? []
  const empty = /^empty=(.*)$/m.exec(result.stdout)?.[1]
  return { ...result, list, empty }
}

describe('shard resolver auth modes', () => {
  test('signed-out lists every root guest preview flow and nothing else', () => {
    const result = resolve('--suite', 'full', '--auth', 'signed-out')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.empty, 'false')
    assert.deepEqual(
      result.list,
      guestFlows.map((name) => `maestro/${name}`)
    )
  })

  test('member shards together cover every member flow and no guest flow', () => {
    const covered = []
    for (const shard of [1, 2]) {
      const result = resolve('--suite', 'full', '--shard', String(shard), '--shards', '2')
      assert.equal(result.status, 0, result.stderr)
      covered.push(...result.list)
    }
    assert.deepEqual(
      covered.sort(),
      memberFlows.map((name) => `maestro/${name}`)
    )
    const explicit = resolve(
      '--suite',
      'full',
      '--auth',
      'member',
      '--shard',
      '1',
      '--shards',
      '1'
    )
    assert.deepEqual(
      explicit.list,
      memberFlows.map((name) => `maestro/${name}`)
    )
  })

  test('the smoke suite holds no signed-out flow, and an empty signed-out suite fails', () => {
    const smoke = resolve('--suite', 'smoke', '--auth', 'signed-out')
    assert.equal(smoke.status, 0, smoke.stderr)
    assert.equal(smoke.empty, 'true')
    for (const name of guestFlows) fs.rmSync(path.join(tree, 'maestro', name))
    try {
      const none = resolve('--suite', 'full', '--auth', 'signed-out')
      assert.equal(none.status, 1)
      assert.match(
        none.stderr,
        /found no flows to run\. Suite input: 'full', auth: 'signed-out'/
      )
    } finally {
      for (const name of guestFlows)
        fs.writeFileSync(path.join(tree, 'maestro', name), '- launchApp\n')
    }
  })

  test('an unknown auth mode fails', () => {
    const result = resolve(
      '--suite',
      'full',
      '--auth',
      'guest',
      '--shard',
      '1',
      '--shards',
      '1'
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--auth must be one of member, signed-out, got guest/)
  })
})

describe('pr-mobile-e2e.yml signed-out lane', () => {
  const rows = matrixRows(job.strategy.matrix)
  // Story CC-7.9: the visual row is a member row outside the packed suite (lane: visual);
  // scripts/ci/maestro-visual-lane.test.mjs holds it.
  const member = rows.filter((row) => row.auth === 'member' && !row.lane)
  const signedOut = rows.filter((row) => row.auth === 'signed-out')
  const visual = rows.filter((row) => row.lane === 'visual')

  test('nine member shards, one signed-out shard, each row a distinct shard number', () => {
    assert.equal(rows.length, member.length + signedOut.length + visual.length)
    assert.equal(member.length, Number(job.env.MAESTRO_MEMBER_SHARDS))
    assert.equal(signedOut.length, 1)
    const shards = rows.map((row) => row.shard)
    assert.equal(new Set(shards).size, shards.length)
    for (const shard of shards)
      assert.ok(Number.isInteger(shard) && shard > 0, String(shard))
  })

  test('the lane runs on ubuntu, in parallel with the member shards, inside the 20-minute ceiling', () => {
    assert.equal(job['runs-on'], 'ubuntu-latest')
    assert.equal(job.strategy['fail-fast'], false)
    assert.ok(job['timeout-minutes'] <= 20)
  })

  test('the resolver packs member rows across the member count and lists guest flows on the signed-out row', () => {
    const run = step("Resolve this shard's flow list").run
    assert.match(run, /--auth "\$\{\{ matrix\.auth \}\}"/)
    assert.match(run, /--shard \$\{\{ matrix\.shard \}\}/)
    assert.match(run, /--shards "\$MAESTRO_MEMBER_SHARDS"/)
    assert.equal(run.includes('strategy.job-total'), false)
  })

  test('only the signed-out row hands run-maestro.mjs --signed-out', () => {
    const script = step('Run Maestro suite').with.script
    assert.equal(
      script,
      "bash ./scripts/ci-mobile-e2e.sh ${{ matrix.auth == 'signed-out' && '--signed-out' || '' }} ${{ steps.flows.outputs.list }}"
    )
    const ciScript = fs.readFileSync(path.join(root, 'scripts/ci-mobile-e2e.sh'), 'utf8')
    assert.match(ciScript, /node \.\/scripts\/run-maestro\.mjs "\$@" --ci/)
  })
})

// The signed-out shard's flows: what they select must exist in the app, and what they
// read must be handed to them, because no emulator runs in this suite.
describe('guest preview flows', () => {
  const rootGuestFlows = [
    'maestro/guest-preview-conversion.yaml',
    'maestro/guest-preview.yaml',
  ]
  const verifyFlow = 'maestro/guest-preview/guest-preview-conversion-verify.yaml'
  const read = (flow) => fs.readFileSync(path.join(root, flow), 'utf8')
  const mobileSource = (() => {
    const out = []
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') visit(full)
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
          out.push(fs.readFileSync(full, 'utf8'))
      }
    }
    for (const directory of [
      'apps/mobile/app',
      'apps/mobile/src',
      'apps/mobile/components',
    ])
      visit(path.join(root, directory))
    return out.join('\n')
  })()
  const literalIds = new Set(
    [...mobileSource.matchAll(/testID(?:=|:\s*)["'`]([^"'`$]+)["'`]/g)].map((m) => m[1])
  )
  const templatePrefixes = [...mobileSource.matchAll(/`([a-z0-9-]+-)\$\{/g)].map(
    (m) => m[1]
  )
  // SignedOutWelcome keeps its testIDs in an action table.
  for (const m of mobileSource.matchAll(/testID: '([^']+)'/g)) literalIds.add(m[1])
  // ChoiceGroup names each option `${testID}-${option.value}` (guest-preview-parts.tsx).
  assert.match(mobileSource, /testID=\{`\$\{testID\}-\$\{option\.value\}`\}/)
  const choiceOption = (id) =>
    ['cold', 'neutral', 'warm', 'low', 'medium', 'high'].some(
      (value) =>
        literalIds.has(id.slice(0, -(value.length + 1))) && id.endsWith(`-${value}`)
    )

  test('the signed-out resolver lists exactly the two root guest flows, and members never get them', () => {
    const signedOut = spawnSync(
      process.execPath,
      ['scripts/resolve-maestro-shard.mjs', '--suite', 'full', '--auth', 'signed-out'],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(signedOut.status, 0, signedOut.stderr)
    assert.equal(/^list=(.*)$/m.exec(signedOut.stdout)?.[1], rootGuestFlows.join(' '))
    const member = spawnSync(
      process.execPath,
      [
        'scripts/resolve-maestro-shard.mjs',
        '--suite',
        'full',
        '--shard',
        '1',
        '--shards',
        '1',
      ],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(member.status, 0, member.stderr)
    assert.equal(
      /guest-preview/.test(/^list=(.*)$/m.exec(member.stdout)?.[1] ?? ''),
      false
    )
  })

  test('each root guest flow starts from a first launch; the verify step is not a root flow', async () => {
    const { firstLaunchProblem } = await import('../lib/maestro-auth-mode.mjs')
    for (const flow of rootGuestFlows)
      assert.equal(firstLaunchProblem(read(flow)), undefined, flow)
    assert.match(firstLaunchProblem(read(verifyFlow)), /first command is not launchApp/)
  })

  test('every element id the guest flows select is a testID the app renders', () => {
    for (const flow of [...rootGuestFlows, verifyFlow]) {
      const ids = [...read(flow).matchAll(/^\s+id: '([^']+)'/gm)].map((m) => m[1])
      assert.ok(ids.length > 5, flow)
      for (const id of ids)
        assert.ok(
          literalIds.has(id) ||
            choiceOption(id) ||
            templatePrefixes.some((prefix) => id.startsWith(prefix)),
          `${flow} selects ${id}, which no apps/mobile testID renders`
        )
    }
  })

  test('every variable a guest flow reads is defined in the flow or handed to it by the runner', () => {
    const runner = fs.readFileSync(path.join(root, 'scripts/run-maestro.mjs'), 'utf8')
    const handed = new Set(
      [...runner.matchAll(/^ {2}`([A-Z_]+)=\$\{/gm)]
        .map((m) => m[1])
        .concat(['MAESTRO_OTP'])
    )
    for (const flow of [...rootGuestFlows, verifyFlow]) {
      const [config] = read(flow).split('\n---\n')
      const defined = new Set(Object.keys(parse(config).env ?? {}))
      for (const [, name] of read(flow).matchAll(/\$\{([A-Z_]+)\}/g))
        assert.ok(defined.has(name) || handed.has(name), `${flow} reads \${${name}}`)
    }
    assert.ok(handed.has('GUEST_PREVIEW_EMAIL'))
    assert.match(read(verifyFlow), /- inputText: \$\{MAESTRO_OTP\}/)
    assert.equal((read(verifyFlow).match(/\$\{MAESTRO_OTP\}/g) ?? []).length, 1)
  })

  test('every subflow a guest flow runs exists', () => {
    for (const flow of rootGuestFlows)
      for (const [, file] of read(flow).matchAll(/- runFlow: (\S+\.yaml)/g))
        assert.ok(fs.existsSync(path.join(root, 'maestro', file)), `${flow} runs ${file}`)
  })
})

describe('pr-mobile-e2e.yml signed-out lane mail and secrets', () => {
  const MAILPIT_KEPT =
    'realtime,studio,postgres-meta,logflare,vector,edge-runtime,supavisor,imgproxy'
  const DEFAULT = MAILPIT_KEPT.replace('supavisor,', 'supavisor,mailpit,')
  /** Evaluates the `${{ matrix.auth == 'signed-out' && 'A' || 'B' }}` shape for one row. */
  const forRow = (value, auth) => {
    const match =
      /^\$\{\{ matrix\.auth == 'signed-out' && '([^']*)' \|\| '([^']*)' \}\}$/.exec(value)
    assert.ok(match, value)
    return auth === 'signed-out' ? match[1] : match[2]
  }

  test('only the signed-out row starts Mailpit, and its preload matches its start', () => {
    const start = step('Start local Supabase services').with.exclude
    const preload = step('Preload the Supabase images').with.exclude
    assert.equal(preload, start)
    assert.equal(forRow(start, 'signed-out'), MAILPIT_KEPT)
    assert.equal(forRow(start, 'member'), DEFAULT)
    const action = parse(
      fs.readFileSync(
        path.join(root, '.github/actions/start-local-supabase/action.yml'),
        'utf8'
      )
    )
    assert.equal(action.inputs.exclude.default, DEFAULT)
  })

  test('the signed-out row scans its artifacts for every sign-in code the run issued', () => {
    const run = step('Run Maestro suite')
    const scan = step('Check Maestro artifacts for secret values')
    assert.equal(
      run.env.MOBILE_E2E_ISSUED_OTP_FILE,
      '${{ runner.temp }}/guest-preview-otps.json'
    )
    assert.equal(scan.env.MOBILE_E2E_ISSUED_OTP_FILE, run.env.MOBILE_E2E_ISSUED_OTP_FILE)
    const flag = /\$\{\{ matrix\.auth == 'signed-out' && '([^']*)' \|\| '' \}\}/.exec(
      scan.run
    )
    assert.equal(flag?.[1], '--otp-file "$MOBILE_E2E_ISSUED_OTP_FILE"')
  })
})
