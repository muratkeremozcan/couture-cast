// Story 6.14 follow-up: every command on the local Supabase start path runs under a
// limit. Mobile e2e run 43161416996 shard 9 sat in "Start local Supabase services" for
// 42 minutes until the job's 45 minute timeout, and run 43079319997 spent the whole start
// budget waiting on a port the runner's own connection held for the job.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const action = parse(
  readFileSync(path.join(root, '.github/actions/start-local-supabase/action.yml'), 'utf8')
)
const step = (name) => {
  const found = action.runs.steps.find((candidate) => candidate.name === name)
  assert.ok(found, `start-local-supabase has a step named ${name}`)
  return found
}
/** A PATH holding stub commands; `timeout` and `gtimeout` scale their limit by `scale`. */
function stubs(t, commands, scale = 1) {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'supabase-bounds-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  const write = (name, body) =>
    writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
  for (const [name, body] of Object.entries(commands)) write(name, body)
  // GNU timeout's contract (exit 124 on expiry, --kill-after), with each limit
  // multiplied by `scale` so a test waits seconds. Portable: no coreutils needed.
  const limited = `kill_after=1
while [[ "$1" == --* ]]; do case "$1" in --kill-after=*) kill_after=$(awk -v s="\${1#*=}" -v k=${scale} 'BEGIN { v = s * k; print (v < 1 ? 1 : v) }') ;; esac; shift; done
seconds=$(awk -v s="$1" -v k=${scale} 'BEGIN { v = s * k; print (v < 1 ? 1 : v) }'); shift
marker="$(mktemp)"; rm -f "$marker"
# Like GNU timeout, signal the command's whole process group, pipelines included.
set -m
"$@" & child=$!
set +m
# The watcher keeps no handle on the caller's output, so it never holds a pipe open.
( /bin/sleep "$seconds"; touch "$marker"; kill -TERM -- "-$child" 2> /dev/null
  /bin/sleep "$kill_after"; kill -KILL -- "-$child" 2> /dev/null ) < /dev/null > /dev/null 2>&1 &
watcher=$!
wait "$child"; status=$?
kill "$watcher" 2> /dev/null; wait "$watcher" 2> /dev/null
if [ -e "$marker" ]; then rm -f "$marker"; exit 124; fi
exit "$status"`
  write('timeout', limited)
  write('gtimeout', limited)
  return bin
}

function runStep(t, name, { commands, env = {}, scale = 1, limitMs = 20_000 }) {
  const bin = stubs(t, commands, scale)
  const temp = mkdtempSync(path.join(os.tmpdir(), 'supabase-bounds-temp-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const githubEnv = path.join(temp, 'github-env')
  const githubOutput = path.join(temp, 'github-output')
  writeFileSync(githubEnv, '')
  writeFileSync(githubOutput, '')
  const started = Date.now()
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step(name).run],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: limitMs,
      killSignal: 'SIGKILL',
      env: {
        PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`,
        HOME: temp,
        RUNNER_TEMP: temp,
        GITHUB_ENV: githubEnv,
        GITHUB_OUTPUT: githubOutput,
        ...env,
      },
    }
  )
  return {
    ...result,
    elapsedMs: Date.now() - started,
    output: readFileSync(githubOutput, 'utf8'),
    log: (() => {
      try {
        return readFileSync(path.join(temp, 'supabase-start/start.log'), 'utf8')
      } catch {
        return ''
      }
    })(),
  }
}

describe('start-local-supabase bounds', () => {
  test('a docker load that never returns is cut off and treated as a cache miss', (t) => {
    const cache = mkdtempSync(path.join(os.tmpdir(), 'supabase-bounds-cache-'))
    t.after(() => rmSync(cache, { recursive: true, force: true }))
    writeFileSync(path.join(cache, 'images.tar.zst'), 'images')
    writeFileSync(path.join(cache, 'registry'), 'ghcr.io')
    const result = runStep(t, 'Load the cached Supabase images', {
      // The 150 s limit scaled to 3 s.
      scale: 0.02,
      commands: { zstd: 'cat "$3"', docker: 'exec sleep 600' },
      env: { CACHE_DIR: cache },
    })
    assert.equal(
      result.signal,
      null,
      `the step was still running after 20 s:\n${result.stdout}`
    )
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.elapsedMs < 15_000, `took ${result.elapsedMs} ms`)
    assert.match(result.output, /^loaded=false$/m)
    assert.match(result.log, /The Supabase image cache did not load; pulling instead/)
  })

  test("a port held by the runner's own connection fails the start at once", (t) => {
    const held =
      'ESTAB 0 0 [::ffff:10.1.1.102]:24322 [::ffff:20.85.130.105]:443 users:(("Runner.Listener",pid=2058,fd=137))'
    const result = runStep(t, 'Start local Supabase with retry', {
      commands: {
        uname: 'echo Linux',
        ss: `echo '${held}'`,
        sudo: 'exit 1',
        npx: 'echo "npx $*" >> "$RUNNER_TEMP/npx-calls"; exit 0',
        docker: 'exit 0',
        jq: 'cat',
        sleep: 'exit 0',
      },
      env: {
        MAX_ATTEMPTS: '6',
        BASE_DELAY: '20',
        MAX_DELAY: '120',
        TIME_BUDGET: '360',
        ATTEMPT_LIMIT: '170',
        MIN_ATTEMPT: '90',
        EXCLUDE:
          'realtime,studio,postgres-meta,logflare,vector,edge-runtime,supavisor,mailpit,imgproxy',
        PRIMARY_REGISTRY: 'ghcr.io',
        FALLBACK_REGISTRIES: 'public.ecr.aws,docker.io',
        CACHE_LOADED: 'false',
        CACHED_REGISTRY: '',
        SAVE_IMAGE_CACHE: 'false',
        CACHE_DIR: '',
        REGISTRY_TOKEN: '',
        SUPABASE_API_PORT: '24321',
        SUPABASE_DB_PORT: '24322',
      },
    })
    assert.equal(
      result.signal,
      null,
      `the start was still waiting after 20 s:\n${result.stdout}`
    )
    assert.equal(result.status, 1)
    assert.ok(result.elapsedMs < 10_000, `took ${result.elapsedMs} ms`)
    assert.match(
      result.stdout,
      /held by the runner's own connection, which lasts the whole job/
    )
    assert.doesNotMatch(result.stdout, /Waiting up to/)
  })

  test('a start attempt that hangs is cut off and the next attempt runs within the budget', (t) => {
    const status = JSON.stringify({
      API_URL: 'http://127.0.0.1:24321',
      ANON_KEY: 'anon',
      SERVICE_ROLE_KEY: 'service',
    })
    const result = runStep(t, 'Start local Supabase with retry', {
      commands: {
        uname: 'echo Linux',
        ss: 'exit 0',
        sudo: 'exit 1',
        docker: 'exit 0',
        sleep: 'exit 0',
        // The first `supabase start` never returns; the second starts.
        npx: `echo "npx $*" >> "$RUNNER_TEMP/npx-calls"
case "$*" in
  "supabase start"*) if [ ! -e "$RUNNER_TEMP/started-once" ]; then touch "$RUNNER_TEMP/started-once"; exec /bin/sleep 600; fi ;;
  "supabase status -o json") echo '${status}' ;;
esac
exit 0`,
      },
      env: {
        MAX_ATTEMPTS: '6',
        BASE_DELAY: '1',
        MAX_DELAY: '1',
        // Room for two 3 s attempts after each one's 15 s kill grace.
        TIME_BUDGET: '40',
        ATTEMPT_LIMIT: '3',
        MIN_ATTEMPT: '2',
        EXCLUDE: 'realtime',
        PRIMARY_REGISTRY: 'ghcr.io',
        FALLBACK_REGISTRIES: '',
        CACHE_LOADED: 'false',
        CACHED_REGISTRY: '',
        SAVE_IMAGE_CACHE: 'false',
        CACHE_DIR: '',
        REGISTRY_TOKEN: '',
        SUPABASE_API_PORT: '24321',
        SUPABASE_DB_PORT: '24322',
      },
    })
    assert.equal(
      result.signal,
      null,
      `the start was still running after 20 s:\n${result.stdout}`
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Supabase startup was cut off after 3s/)
    assert.match(result.stdout, /attempt 2\/6/)
    assert.match(result.stdout, /Supabase services started successfully/)
  })

  test('the budget is an absolute deadline: status, diagnostics and stop end inside it', (t) => {
    // Every Supabase CLI call hangs: the start, then status and stop after it is cut off.
    const result = runStep(t, 'Start local Supabase with retry', {
      commands: {
        uname: 'echo Linux',
        ss: 'exit 0',
        sudo: 'exit 1',
        sleep: 'exit 0',
        docker: 'exit 0',
        npx: 'echo "npx $*" >> "$RUNNER_TEMP/npx-calls"; exec /bin/sleep 600',
      },
      env: {
        MAX_ATTEMPTS: '2',
        BASE_DELAY: '1',
        MAX_DELAY: '1',
        TIME_BUDGET: '6',
        ATTEMPT_LIMIT: '4',
        MIN_ATTEMPT: '2',
        EXCLUDE: 'realtime',
        PRIMARY_REGISTRY: 'ghcr.io',
        FALLBACK_REGISTRIES: '',
        CACHE_LOADED: 'false',
        CACHED_REGISTRY: '',
        SAVE_IMAGE_CACHE: 'false',
        CACHE_DIR: '',
        REGISTRY_TOKEN: 'token',
        SUPABASE_API_PORT: '24321',
        SUPABASE_DB_PORT: '24322',
      },
    })
    assert.equal(
      result.signal,
      null,
      `the step outlived its 6 s budget by more than 14 s:\n${result.stdout}`
    )
    assert.notEqual(result.status, 0)
    // The budget plus one kill grace for the call running when it ran out.
    assert.ok(result.elapsedMs < 17_000, `took ${result.elapsedMs} ms`)
    assert.match(
      result.stderr + result.stdout,
      /The Supabase start budget \(6s\) is spent; skipped/
    )
  })

  test('a slow registry login leaves the start only what is left of the deadline', (t) => {
    // Codex review of PR 211: the attempt was sized before a 60 s login, so a 165 s
    // attempt ended at 420 s against 360. Here the login takes 20 s of a 40 s budget.
    const result = runStep(t, 'Start local Supabase with retry', {
      limitMs: 70_000,
      commands: {
        uname: 'echo Linux',
        ss: 'exit 0',
        sudo: 'exit 1',
        sleep: 'exit 0',
        docker:
          'if [ "$1" = login ]; then cat > /dev/null; exec /bin/sleep 20; fi; exit 0',
        npx: 'exec /bin/sleep 600',
      },
      env: {
        MAX_ATTEMPTS: '3',
        BASE_DELAY: '1',
        MAX_DELAY: '1',
        TIME_BUDGET: '40',
        ATTEMPT_LIMIT: '30',
        MIN_ATTEMPT: '2',
        EXCLUDE: 'realtime',
        PRIMARY_REGISTRY: 'ghcr.io',
        FALLBACK_REGISTRIES: '',
        CACHE_LOADED: 'false',
        CACHED_REGISTRY: '',
        SAVE_IMAGE_CACHE: 'false',
        CACHE_DIR: '',
        REGISTRY_TOKEN: 'token',
        SUPABASE_API_PORT: '24321',
        SUPABASE_DB_PORT: '24322',
      },
    })
    assert.equal(result.signal, null, `still running after 70 s:\n${result.stdout}`)
    assert.notEqual(result.status, 0)
    assert.ok(
      result.elapsedMs < 41_000,
      `took ${result.elapsedMs} ms against a 40 s deadline`
    )
    // The attempt got the budget left after the login, less the start's kill grace.
    assert.match(
      result.stdout,
      /attempt 1\/3, registry ghcr\.io, ([1-5])s for this attempt/
    )
  })

  test('every docker and npx call on the start path runs under a limit', () => {
    const unbounded = []
    for (const candidate of action.runs.steps) {
      if (!candidate.run) continue
      for (const [index, line] of candidate.run.split('\n').entries()) {
        const code = line.replace(/#.*$/, '')
        if (!/(^|[\s|;(&])(docker|npx)\s/.test(code)) continue
        // `bounded` and `timeout` wrap a call; run_start puts npx supabase start under one.
        if (/\b(bounded|timeout|gtimeout|deadline_command)\b/.test(code)) continue
        if (/"\$deadline_command"/.test(code)) continue
        // A quoted docker or npx inside an echoed message or a bash -c body is not a call.
        if (/^\s*(echo|printf)\b/.test(code) || /'[^']*\b(docker|npx)\b[^']*'/.test(code))
          continue
        unbounded.push(`${candidate.name}:${index + 1}: ${line.trim()}`)
      }
    }
    assert.deepEqual(unbounded, [])
  })

  test('every caller bounds the start step, keeps its log and stops what a failed start left', () => {
    const dir = path.join(root, '.github/workflows')
    const sites = []
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
      const workflow = parse(readFileSync(path.join(dir, file), 'utf8'))
      for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
        const steps = job.steps ?? []
        for (const [index, candidate] of steps.entries()) {
          if (candidate.uses !== './.github/actions/start-local-supabase') continue
          const site = `${file}:${name}`
          sites.push(site)
          assert.ok(candidate.id, `${site} names its start step`)
          assert.ok(
            candidate['timeout-minutes'] > 0 && candidate['timeout-minutes'] <= 10,
            `${site} gives its start step a timeout of 10 minutes or less`
          )
          // The next step keeps the log of a failed start: an artifact, or the job log in
          // pr-share-card-native, whose lanes upload no log files (share-card-lanes.mjs).
          const keep = steps[index + 1]
          if (file === 'pr-share-card-native.yml')
            assert.match(
              keep?.run ?? '',
              /tail -n \d+ "\$RUNNER_TEMP\/supabase-start\/start\.log"/,
              site
            )
          else {
            assert.equal(
              keep?.uses,
              'actions/upload-artifact@v4',
              `${site} uploads the log`
            )
            assert.equal(
              keep.with.path,
              '${{ runner.temp }}/supabase-start/start.log',
              site
            )
          }
          assert.match(
            keep.if,
            new RegExp(`steps\\.${candidate.id}\\.outcome == 'failure'`),
            site
          )
          // Then clear the containers a start cut off by its budget or step timeout left.
          const stop = steps[index + 2]
          assert.match(
            stop?.run ?? '',
            /^timeout --kill-after=\d+ \d+ npx supabase stop --no-backup$/,
            site
          )
          assert.ok(stop['timeout-minutes'] > 0 && stop['timeout-minutes'] <= 2, site)
          assert.equal(
            stop.if,
            `\${{ always() && steps.${candidate.id}.outcome == 'failure' }}`,
            site
          )
        }
      }
    }
    assert.ok(sites.length >= 9, sites.join(', '))
  })
})
