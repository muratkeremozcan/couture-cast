import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { shareCardWebCommand } from './web.mjs'

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
