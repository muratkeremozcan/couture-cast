// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  APP_INPUTS,
  LEGS,
  changedInputs,
  importClosure,
  legInputs,
  moduleRelativeLiterals,
  objectId,
  relativeImports,
  repoPathLiterals,
  uncoveredReads,
  writeManifest,
} from './evidence-manifest.mjs'

const execFileAsync = promisify(execFile)

/** A throwaway repository holding the live-font leg's inputs. */
function fixtureRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-manifest-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const write = (file, text) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'user.name', 'fixture')
  write('apps/mobile/app.json', '{}')
  write('packages/utils/index.ts', 'export {}')
  write('package.json', '{}')
  write('package-lock.json', '{}')
  write('maestro/live-font/open-home.yaml', 'appId: x')
  write('maestro/story65/open-app.yaml', 'appId: x')
  write('scripts/lib/live-font-journey.mjs', "import { a } from './helper.mjs'\n")
  write('scripts/lib/helper.mjs', 'export const a = 1\n')
  write('scripts/run-live-font-proof.mjs', "import './lib/live-font-journey.mjs'\n")
  write('scripts/run-story68-native.mjs', '')
  const commit = (message) => {
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { dir, write, commit, git }
}

test('relativeImports reads static, side-effect, dynamic and re-export specifiers', () => {
  const source = [
    "import fs from 'node:fs'",
    "import { a } from './a.mjs'",
    "import './b.mjs'",
    "const c = await import('../c.mjs')",
    "export { d } from './d.mjs'",
  ].join('\n')
  assert.deepEqual(relativeImports(source).sort(), [
    '../c.mjs',
    './a.mjs',
    './b.mjs',
    './d.mjs',
  ])
})

test('a manifest records each input and verify finds nothing changed at the same tree', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  assert.equal(manifest.leg, 'live-font')
  assert.match(manifest.sha, /^[0-9a-f]{40}$/)
  for (const file of [
    'apps/mobile',
    'packages',
    'scripts/lib/helper.mjs',
    'scripts/run-live-font-proof.mjs',
  ])
    assert.match(manifest.inputs[file], /^[0-9a-f]{40}$/, file)
  // Optional inputs this repository lacks are recorded as absent.
  assert.equal(manifest.inputs['.nvmrc'], null)
  // A docs-only commit changes no input.
  repo.write('docs/notes.md', 'notes')
  repo.commit('docs')
  assert.deepEqual(changedInputs(manifest, { cwd: repo.dir }), [])
})

test('verify names a changed app path, a changed harness import and a new harness import', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  repo.write('scripts/lib/helper.mjs', 'export const a = 2\n')
  repo.write('apps/mobile/app.json', '{"changed":true}')
  repo.write('scripts/lib/helper.mjs', "import './extra.mjs'\nexport const a = 2\n")
  repo.write('scripts/lib/extra.mjs', '')
  repo.write('.nvmrc', '22')
  repo.commit('change')
  assert.deepEqual(
    changedInputs(manifest, { cwd: repo.dir }).map((change) => change.path),
    ['.nvmrc', 'apps/mobile', 'scripts/lib/extra.mjs', 'scripts/lib/helper.mjs']
  )
})

test('imports into node_modules are left to package-lock.json', (t) => {
  const repo = fixtureRepo(t)
  repo.write('scripts/lib/helper.mjs', "import '../../node_modules/pkg/index.js'\n")
  const sha = repo.commit('installed import')
  assert.deepEqual(importClosure(['scripts/lib/helper.mjs'], sha, repo.dir), [
    'scripts/lib/helper.mjs',
  ])
})

// TEA, 2026-11-13: the build compiles the working tree, so a manifest refuses uncommitted or
// untracked input files, and a revision other than the checked-out HEAD.
test('writing a manifest refuses a dirty or untracked input and a non-HEAD revision', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('build')
  repo.write('apps/mobile/app.json', '{"edited":true}')
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:.*apps\/mobile\/app\.json/,
  })
  repo.commit('edit')
  repo.write('scripts/lib/new-helper.mjs', '')
  repo.write('scripts/lib/helper.mjs', "import './new-helper.mjs'\nexport const a = 1\n")
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:/,
  })
  repo.commit('import')
  // An untracked file inside an input directory counts too.
  repo.write('packages/utils/stray.ts', 'export {}')
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:.*packages\/utils\/stray\.ts/,
  })
  repo.commit('stray')
  // A change outside the inputs is fine; an older revision is refused.
  repo.write('docs/notes.md', 'notes')
  assert.equal(writeManifest({ leg: 'live-font', cwd: repo.dir }).leg, 'live-font')
  assert.throws(() => writeManifest({ leg: 'live-font', rev: first, cwd: repo.dir }), {
    message: `evidence_manifest_rev_not_head:${first}`,
  })
})

test('a missing harness entry fails loudly', (t) => {
  const repo = fixtureRepo(t)
  repo.write('scripts/lib/helper.mjs', "import './gone.mjs'\n")
  const sha = repo.commit('broken')
  assert.throws(() => importClosure(['scripts/lib/helper.mjs'], sha, repo.dir), {
    message: 'evidence_manifest_entry_missing:scripts/lib/gone.mjs',
  })
})

test('every leg resolves on this repository and covers the app inputs', () => {
  for (const leg of Object.keys(LEGS)) {
    const manifest = writeManifest({ leg, requireClean: false })
    for (const file of ['apps/mobile', 'packages', 'package.json', 'package-lock.json'])
      assert.match(manifest.inputs[file], /^[0-9a-f]{40}$/, `${leg}: ${file}`)
    assert.ok(
      APP_INPUTS.every((file) => file in manifest.inputs),
      leg
    )
  }
  const server = writeManifest({ leg: 'test-store', requireClean: false }).inputs
  assert.match(server['apps/api'], /^[0-9a-f]{40}$/)
  assert.match(server['packages/db'], /^[0-9a-f]{40}$/)
  // The Test Store driver and every helper it imports, so a harness change reruns the leg.
  for (const file of [
    'scripts/run-test-store-journey.mjs',
    'scripts/test-store-preview-webhook.mjs',
    'scripts/lib/test-store-runner.mjs',
    'scripts/lib/test-store-proxy.mjs',
    'scripts/lib/minified-debuggable-evidence.mjs',
  ])
    assert.match(server[file], /^[0-9a-f]{40}$/, file)
  const liveFont = writeManifest({ leg: 'live-font', requireClean: false }).inputs
  assert.ok('scripts/lib/live-font-scale-proof.mjs' in liveFont)
  assert.ok('scripts/lib/live-font-capture.mjs' in liveFont)
})

// Antigravity r9 (P2-1): every leg covers every repository path its harness names, so evidence
// can never match a head whose harness data changed.
test('no harness reads a repository path outside its leg inputs', () => {
  for (const leg of Object.keys(LEGS)) assert.deepEqual(uncoveredReads(leg), [], leg)
})

test('every leg takes the whole maestro tree; legs that boot the API take the server', () => {
  for (const leg of Object.keys(LEGS)) assert.ok(LEGS[leg].paths.includes('maestro'), leg)
  for (const leg of ['live-font', 'ios-build', 'test-store', 'upgrade'])
    for (const input of ['apps/api', 'packages/db', 'supabase'])
      assert.ok(LEGS[leg].paths.includes(input), `${leg}: ${input}`)
  assert.ok(LEGS['live-font'].paths.includes('scripts/lib/fixtures'))
})

test('repository path literals, root joins and module-relative URLs are found', () => {
  const source = [
    "const a = path.join(root, 'scripts/lib/fixtures/live-font-residual-baselines.json')",
    "run('maestro', [path.join(root, 'maestro/live-font', `${flow}.yaml`)])",
    "const b = path.resolve(root, 'maestro', 'subflows', 'open.yaml')",
    'const c = `maestro/story68/${name}.yaml`',
    "spawn('node', ['scripts/ci/native-supabase.mjs'])",
    "const d = '_bmad-output/test-artifacts/runs'",
  ].join('\n')
  assert.deepEqual(repoPathLiterals(source), [
    'maestro/live-font',
    'maestro/story68',
    'maestro/subflows/open.yaml',
    'scripts/ci/native-supabase.mjs',
    'scripts/lib/fixtures/live-font-residual-baselines.json',
  ])
  assert.deepEqual(
    moduleRelativeLiterals(
      "new URL('./fixtures/x.json', import.meta.url); new URL('../../', import.meta.url)",
      'scripts/lib/y.mjs'
    ),
    ['scripts/lib/fixtures/x.json']
  )
  assert.deepEqual(
    relativeImports(
      "const r = createRequire(import.meta.url); r('./x.cjs'); require('../y.js')"
    ),
    ['../y.js']
  )
})

test('the closure follows requires and scripts a harness spawns by path; globs recurse', (t) => {
  const repo = fixtureRepo(t)
  repo.write(
    'scripts/run-live-font-proof.mjs',
    "import './lib/live-font-journey.mjs'\nspawn('node', ['scripts/spawned.mjs'])\n"
  )
  repo.write('scripts/spawned.mjs', "require('./lib/required.cjs')\n")
  repo.write('scripts/lib/required.cjs', '')
  repo.write('scripts/lib/live-font-nested/deep.json', '{}')
  const sha = repo.commit('closure')
  const inputs = legInputs('live-font', sha, repo.dir)
  for (const file of [
    'scripts/spawned.mjs',
    'scripts/lib/required.cjs',
    'scripts/lib/live-font-nested/deep.json',
  ])
    assert.ok(inputs.includes(file), file)
})

// Antigravity r9 (P2-2): verify refuses what write refuses.
test('verify refuses a dirty input tree and a rev other than HEAD', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  repo.write('scripts/lib/helper.mjs', 'export const a = 3\n')
  assert.throws(() => changedInputs(manifest, { cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:/,
  })
  repo.commit('change')
  assert.throws(() => changedInputs(manifest, { rev: first, cwd: repo.dir }), {
    message: `evidence_manifest_rev_not_head:${first}`,
  })
  assert.deepEqual(
    changedInputs(manifest, { cwd: repo.dir }).map((change) => change.path),
    ['scripts/lib/helper.mjs']
  )
})

// Antigravity r10 (P3): shell entries are scanned for the paths they name bare.
test('a shell entry names paths bare, and the network-timeout leg scans its script', () => {
  const source = [
    'node scripts/lib/network-tarpit.mjs --port 4010 &',
    'maestro test "maestro/network-timeout/dev-client-timeout.yaml"',
    'APK=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk',
  ].join('\n')
  assert.deepEqual(repoPathLiterals(source, { shell: true }), [
    'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk',
    'maestro/network-timeout/dev-client-timeout.yaml',
    'scripts/lib/network-tarpit.mjs',
  ])
  assert.ok(
    LEGS['network-timeout'].entries.includes('scripts/ci/android-network-timeout.sh')
  )
})

// Antigravity r10 (P3): an untracked file a leg glob would match makes the tree dirty.
test('an untracked file matching a leg glob is a dirty input', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  repo.write('scripts/lib/live-font-new.mjs', '')
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:.*scripts\/lib\/live-font-new\.mjs/,
  })
})

// Antigravity r10 (P3): verify with no manifest is a usage error, never a pass.
test('verify with no manifest exits 2 with usage', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/lib/evidence-manifest.mjs', 'verify'],
    {
      encoding: 'utf8',
    }
  )
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage: evidence-manifest\.mjs verify/)
})

// Antigravity r24 (P2): a git call killed at its bound, failing to spawn or exiting nonzero fails
// the manifest. Each case runs the module in a child against a stub git on PATH that hangs past
// a short bound (or exits 2) for one call and hands every other call to the real git.
const MODULE = new URL('./evidence-manifest.mjs', import.meta.url).href
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], {
  encoding: 'utf8',
  timeout: 10_000,
  killSignal: 'SIGKILL',
}).stdout.trim()
const STUB_GIT = `#!/bin/sh
case " $* " in
  *"$STUB_MATCH"*)
    if [ "$STUB_MODE" = fail ]; then echo "fatal: stub" >&2; exit 2; fi
    if [ "$STUB_MODE" = garbage ]; then echo "not-an-object-id"; exit 0; fi
    if [ "$STUB_MODE" = stderr ]; then echo "fatal: stub-detail-1f2e" >&2; exit 1; fi
    exec sleep 30 ;;
esac
exec "$REAL_GIT" "$@"
`

/** Runs `call` (an expression over the module's exports `m` and `sha`) under the stub git. */
async function underStubGit(t, repo, { match, mode = 'hang', call, path: PATH }) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-git-stub-'))
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }))
  fs.writeFileSync(path.join(bin, 'git'), STUB_GIT, { mode: 0o755 })
  const script = `
    const m = await import(${JSON.stringify(MODULE)})
    const sha = ${JSON.stringify(repo.git('rev-parse', 'HEAD'))}
    try { console.log(JSON.stringify({ value: await (${call}) ?? null })) }
    catch (error) { console.log(JSON.stringify({ error: error.message, code: error.code })) }`
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: repo.dir,
      timeout: 20_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        PATH: PATH ?? `${bin}:${process.env.PATH}`,
        REAL_GIT,
        STUB_MATCH: match ?? '',
        STUB_MODE: mode,
        EVIDENCE_MANIFEST_GIT_TIMEOUT_MS: '1500',
      },
    }
  )
  return JSON.parse(stdout)
}

const STRICT_PATHS = [
  // The dirty check: a timed-out status passed a dirty tree under requireClean.
  ['dirty check', 'status', "m.writeManifest({ leg: 'live-font' })", 'status'],
  // The glob: a timed-out ls-tree dropped every file the glob names.
  ['glob', 'ls-tree', "m.legInputs('live-font', sha)", 'ls-tree'],
  // rev-parse of the build revision: a timed-out one gave an empty sha.
  ['rev-parse', '--end-of-options', "m.writeManifest({ leg: 'live-font' })", 'rev-parse'],
  // objectId: a timed-out lookup recorded the input as absent.
  ['objectId', '--quiet', "m.objectId(sha, 'package.json')", 'rev-parse'],
  // show: a timed-out read dropped a harness import from the closure.
  ['show', ' show ', "m.importClosure(['scripts/run-live-font-proof.mjs'], sha)", 'show'],
]

test('a hung or failing git call throws evidence_git_failed on every path', async (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  // Dirty, so a status that read as clean would be caught passing.
  repo.write('apps/mobile/app.json', '{"edited":true}')
  // A success that prints no object id, from either rev-parse, throws too.
  const garbage = STRICT_PATHS.filter(
    ([name]) => name === 'rev-parse' || name === 'objectId'
  )
  await Promise.all([
    ...garbage.map(async ([name, match, call, subcommand]) =>
      assert.deepEqual(
        await underStubGit(t, repo, { match, mode: 'garbage', call }),
        {
          error: `evidence_git_failed:${subcommand}:not_an_object_id`,
          code: 'evidence_git_failed',
        },
        `${name} (garbage)`
      )
    ),
    ...STRICT_PATHS.flatMap(([name, match, call, subcommand]) =>
      [
        ['hang', 'ETIMEDOUT'],
        ['fail', 'exit_2'],
      ].map(async ([mode, how]) => {
        const result = await underStubGit(t, repo, { match, mode, call })
        assert.deepEqual(
          result,
          {
            error: `evidence_git_failed:${subcommand}:${how}`,
            code: 'evidence_git_failed',
          },
          `${name} (${mode})`
        )
      })
    ),
  ])
})

// Antigravity r25 (1): exit 1 is the not-found status only with nothing on stderr; with a
// message it is a failure, and the message stays out of the error.
test('objectId throws on exit 1 with stderr, leaving the stderr text out', async (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const result = await underStubGit(t, repo, {
    match: '--quiet',
    mode: 'stderr',
    call: "m.objectId(sha, 'package.json')",
  })
  assert.deepEqual(result, {
    error: 'evidence_git_failed:rev-parse:exit_1',
    code: 'evidence_git_failed',
  })
  assert.doesNotMatch(JSON.stringify(result), /stub-detail/)
})

// Antigravity r25 (2): a shallow clone lacks the older commit, and `--quiet` exits 1 for a
// missing commit as for a missing path. objectId verifies the commit first, so that throws, and
// only a path missing under a present commit reads as absent.
test('objectId on a commit a shallow clone lacks throws; a missing path under it is null', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('first')
  repo.write('docs/notes.md', 'notes')
  const second = repo.commit('second')
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-shallow-'))
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }))
  const cloned = spawnSync(
    'git',
    ['clone', '-q', '--depth', '1', `file://${repo.dir}`, clone],
    { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }
  )
  assert.equal(cloned.status, 0, cloned.stderr)
  // Verified in the full repository first: the memo is per repository, so this must not carry
  // over to the clone.
  assert.match(objectId(first, 'package.json', repo.dir), /^[0-9a-f]{40}$/)
  // Twice: a failed verification is not remembered as a pass.
  for (let round = 0; round < 2; round += 1)
    assert.throws(() => objectId(first, 'package.json', clone), {
      message: 'evidence_git_failed:rev-parse:exit_128',
    })
  assert.match(objectId(second, 'package.json', clone), /^[0-9a-f]{40}$/)
  assert.equal(objectId(second, 'scripts/absent.mjs', clone), null)
})

// Antigravity r26 (1): no verified commit outlives one manifest call. A shallow re-clone at the
// same path drops a commit verified earlier in the same process; every later call throws.
test('a commit verified before a same-path shallow re-clone is checked again', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('first')
  repo.write('docs/notes.md', 'notes')
  repo.commit('second')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-reclone-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const clone = path.join(base, 'clone')
  const cloneInto = (...flags) => {
    fs.rmSync(clone, { recursive: true, force: true })
    const result = spawnSync(
      'git',
      ['clone', '-q', ...flags, `file://${repo.dir}`, clone],
      {
        encoding: 'utf8',
        timeout: 30_000,
        killSignal: 'SIGKILL',
      }
    )
    assert.equal(result.status, 0, result.stderr)
  }
  const at = { leg: 'live-font', rev: first, cwd: clone, requireClean: false }
  cloneInto()
  const manifest = writeManifest(at)
  assert.match(manifest.inputs['package.json'], /^[0-9a-f]{40}$/)
  assert.match(objectId(first, 'package.json', clone), /^[0-9a-f]{40}$/)
  cloneInto('--depth', '1')
  const missing = { message: 'evidence_git_failed:rev-parse:exit_128' }
  assert.throws(() => writeManifest(at), missing)
  assert.throws(() => changedInputs(manifest, at), missing)
  assert.throws(() => objectId(first, 'package.json', clone), missing)
})

// Antigravity r26 (2): HEAD can move, so a manifest call's set never takes it as verified.
test('objectId checks HEAD on every call, within one verified set', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const verified = new Set()
  assert.equal(objectId('HEAD', 'docs/new.md', repo.dir, verified), null)
  repo.write('docs/new.md', 'new')
  repo.commit('new')
  assert.match(objectId('HEAD', 'docs/new.md', repo.dir, verified), /^[0-9a-f]{40}$/)
  // HEAD on an unborn branch names no commit: the next call throws.
  repo.git('symbolic-ref', 'HEAD', 'refs/heads/unborn')
  assert.throws(() => objectId('HEAD', 'package.json', repo.dir, verified), {
    message: 'evidence_git_failed:rev-parse:exit_128',
  })
})

// Antigravity r25 (3): the build revision peels to a commit; an annotated tag gives its commit,
// and a tree is refused.
test('a manifest revision peels an annotated tag to its commit and refuses a tree', (t) => {
  const repo = fixtureRepo(t)
  const sha = repo.commit('build')
  repo.git('tag', '-a', 'v-build', '-m', 'build')
  assert.notEqual(repo.git('rev-parse', 'v-build'), sha)
  for (const requireClean of [true, false])
    assert.equal(
      writeManifest({ leg: 'live-font', rev: 'v-build', cwd: repo.dir, requireClean })
        .sha,
      sha
    )
  assert.throws(
    () =>
      writeManifest({
        leg: 'live-font',
        rev: 'HEAD^{tree}',
        cwd: repo.dir,
        requireClean: false,
      }),
    { message: 'evidence_git_failed:rev-parse:exit_128', code: 'evidence_git_failed' }
  )
})

test('a git that cannot spawn throws evidence_git_failed', async (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-no-git-'))
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }))
  const result = await underStubGit(t, repo, {
    call: "m.writeManifest({ leg: 'live-font' })",
    path: empty,
  })
  assert.deepEqual(result, {
    error: 'evidence_git_failed:rev-parse:ENOENT',
    code: 'evidence_git_failed',
  })
})

test('a git bound of 0 or text refuses to load', async () => {
  for (const value of ['0', 'abc', '-1']) {
    const result = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(MODULE)})`],
      {
        timeout: 20_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, EVIDENCE_MANIFEST_GIT_TIMEOUT_MS: value },
      }
    ).then(
      () => ({ code: 0 }),
      (error) => error
    )
    assert.equal(result.code, 1, value)
    assert.match(
      result.stderr,
      new RegExp(`evidence_git_timeout_invalid: ${value}`),
      value
    )
  }
})

test('only a clean not-found exit reads as absent', (t) => {
  const repo = fixtureRepo(t)
  const sha = repo.commit('build')
  assert.equal(objectId(sha, 'scripts/absent.mjs', repo.dir), null)
  assert.match(objectId(sha, 'package.json', repo.dir), /^[0-9a-f]{40}$/)
  // show's not-found exit: an entry absent at the revision, present only on disk too.
  repo.write('scripts/on-disk-only.mjs', '')
  for (const entry of ['scripts/absent.mjs', 'scripts/on-disk-only.mjs'])
    assert.throws(() => importClosure([entry], sha, repo.dir), {
      message: `evidence_manifest_entry_missing:${entry}`,
    })
  // Outside a repository git exits 128 with its own message: that throws, never null.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-no-repo-'))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  assert.throws(() => objectId(sha, 'package.json', outside), {
    message: 'evidence_git_failed:rev-parse:exit_128',
  })
  assert.throws(() => importClosure(['scripts/run-live-font-proof.mjs'], sha, outside), {
    message: 'evidence_git_failed:show:exit_128',
  })
})

test('write and verify exit 1 with the code on stderr when git hangs', async (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const manifest = path.join(repo.dir, 'manifest.json')
  fs.writeFileSync(
    manifest,
    JSON.stringify(writeManifest({ leg: 'live-font', cwd: repo.dir }))
  )
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-git-stub-'))
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }))
  fs.writeFileSync(path.join(bin, 'git'), STUB_GIT, { mode: 0o755 })
  const cli = fileURLToPath(MODULE)
  for (const args of [
    ['write', '--leg', 'live-font', '--out', path.join(repo.dir, 'out.json')],
    ['verify', manifest],
  ]) {
    const result = await execFileAsync(process.execPath, [cli, ...args], {
      cwd: repo.dir,
      timeout: 20_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REAL_GIT,
        STUB_MATCH: 'status',
        EVIDENCE_MANIFEST_GIT_TIMEOUT_MS: '1500',
      },
    }).then(
      () => ({ code: 0 }),
      (error) => error
    )
    assert.equal(result.code, 1, args[0])
    assert.equal(
      result.stderr,
      'evidence-manifest: evidence_git_failed:status:ETIMEDOUT\n',
      args[0]
    )
  }
  assert.equal(fs.existsSync(path.join(repo.dir, 'out.json')), false)
})
