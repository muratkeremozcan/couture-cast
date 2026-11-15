import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { shareCardWebCommand, waitForAuthHarness } from './web.mjs'

function owned(envFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-command-'))
  const directory = path.join(root, 'runtime')
  fs.mkdirSync(directory)
  fs.writeFileSync(
    path.join(directory, 'public-build-env.json'),
    JSON.stringify({
      EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'owned-anon',
    })
  )
  fs.writeFileSync(
    path.join(directory, 'auth-harness.json'),
    JSON.stringify({ proxyUrl: 'http://127.0.0.1:53068' })
  )
  for (const [name, text] of Object.entries(envFiles))
    fs.writeFileSync(path.join(root, name), text)
  return {
    root,
    directory,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}
const ownedValues = {
  NODE_ENV: 'production',
  WEB_NEXT_DIST_DIR: '.next-share-card',
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:53068',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'owned-anon',
  NEXT_PUBLIC_E2E_AUTH: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
}

test('build compiles the production web and start serves it on the owned origin, with one env', () => {
  const f = owned()
  try {
    const build = shareCardWebCommand('build', { ...f, env: { CI: 'true' } })
    assert.deepEqual(build.args, ['run', 'build', '--workspace', 'web'])
    assert.equal(build.cwd, f.root)
    const start = shareCardWebCommand('start', { ...f, env: { CI: 'true' } })
    assert.equal(start.program, process.execPath)
    assert.deepEqual(start.args, [
      path.join(f.root, 'node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3088',
    ])
    assert.equal(start.cwd, path.join(f.root, 'apps/web'))
    assert.deepEqual(build.env, { CI: 'true', ...ownedValues })
    assert.deepEqual(start.env, build.env)
  } finally {
    f.cleanup()
  }
})

test('every key a repo env file defines reaches the production build blank or owned', () => {
  const f = owned({
    '.env.prod': 'POSTHOG_API_KEY=phc_live\nPROD_API_BASE_URL=https://api.example.test\n',
    '.env.local': 'NEXT_PUBLIC_API_BASE_URL=https://remote.example.test\n',
    '.env': 'NODE_ENV=development\n',
  })
  try {
    const { env } = shareCardWebCommand('build', {
      ...f,
      env: { POSTHOG_API_KEY: 'phc_shell', PATH: '/usr/bin' },
    })
    assert.equal(env.POSTHOG_API_KEY, '')
    assert.equal(env.PROD_API_BASE_URL, '')
    assert.equal(env.NEXT_PUBLIC_API_BASE_URL, 'http://127.0.0.1:4088')
    assert.equal(env.NODE_ENV, 'production')
    assert.equal(env.PATH, '/usr/bin')
  } finally {
    f.cleanup()
  }
})

test('a missing or development subcommand is refused before reading the runtime', () => {
  for (const command of [undefined, 'dev'])
    assert.throws(
      () =>
        shareCardWebCommand(command, {
          root: '/nonexistent',
          directory: '/nonexistent',
          env: {},
        }),
      /usage: node scripts\/e2e-share-card\/web\.mjs build\|start/
    )
})

// Dispatch 43687651012 browser-acceptance: `web.mjs build` read auth-harness.json 43 s after the
// owned auth proxy started in the background, before the proxy wrote it (ENOENT). The build now
// waits for a whole harness file, and names an auth service that already exited.
test('the web build waits for the owned auth harness, bounded, and names a dead auth service', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-web-auth-wait-'))
  try {
    const harness = path.join(root, 'auth-harness.json')
    const exitFile = path.join(root, 'cc68-auth.exit')
    let clock = 0
    const timing = {
      now: () => clock,
      delay: async (ms) => {
        clock += ms
      },
    }
    let polls = 0
    const appearing = {
      ...timing,
      delay: async (ms) => {
        clock += ms
        polls += 1
        // A half-written file first, then the whole one.
        if (polls === 2) fs.writeFileSync(harness, '{"proxyUrl":')
        if (polls === 4)
          fs.writeFileSync(
            harness,
            JSON.stringify({ proxyUrl: 'http://127.0.0.1:53068' })
          )
      },
    }
    assert.deepEqual(
      await waitForAuthHarness({
        directory: root,
        exitFile,
        timeoutMs: 60_000,
        ...appearing,
      }),
      { proxyUrl: 'http://127.0.0.1:53068' }
    )
    assert.equal(polls, 4)

    fs.rmSync(harness)
    clock = 0
    await assert.rejects(
      waitForAuthHarness({ directory: root, exitFile, timeoutMs: 60_000, ...timing }),
      { message: 'owned_auth_harness_timeout: no auth-harness.json after 60000 ms' }
    )

    fs.writeFileSync(exitFile, '1\n')
    clock = 0
    await assert.rejects(
      waitForAuthHarness({ directory: root, exitFile, timeoutMs: 60_000, ...timing }),
      {
        message: 'owned_auth_harness_exited: the owned auth service exited with status 1',
      }
    )
    assert.equal(clock, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
