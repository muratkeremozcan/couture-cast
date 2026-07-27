const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const mobileRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(mobileRoot, '../..')
const expoCli = require.resolve('expo/bin/cli', { paths: [repositoryRoot] })
const defaultFixtureEntries = ['app.json', 'package.json', 'plugins', 'targets', 'assets']

function createExpoPrebuildWorkspace({ prefix, entries = defaultFixtureEntries }) {
  assert.match(prefix, /^couture-[a-z0-9-]+-$/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  for (const entry of entries) {
    fs.cpSync(path.join(mobileRoot, entry), path.join(root, entry), {
      recursive: true,
    })
  }
  fs.symlinkSync(
    path.join(repositoryRoot, 'node_modules'),
    path.join(root, 'node_modules')
  )

  return {
    root,
    cleanup() {
      assert.ok(root.startsWith(os.tmpdir()))
      assert.match(path.basename(root), new RegExp(`^${prefix}`))
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function createExpoPrebuildFixture(testContext, options) {
  const workspace = createExpoPrebuildWorkspace(options)
  testContext.after(workspace.cleanup)
  return workspace.root
}

function runExpoPrebuild(fixtureRoot, { platform = 'ios', timeout = 50_000 } = {}) {
  return spawnSync(
    process.execPath,
    [expoCli, 'prebuild', '--platform', platform, '--no-install'],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
      timeout,
    }
  )
}

function assertCommand(result, label) {
  assert.equal(
    result.status,
    0,
    `${label}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
  )
}

module.exports = {
  assertCommand,
  createExpoPrebuildFixture,
  createExpoPrebuildWorkspace,
  mobileRoot,
  repositoryRoot,
  runExpoPrebuild,
}
