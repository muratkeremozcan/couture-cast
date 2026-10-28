import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const installScript = path.join(repoRoot, 'scripts/ci/install-dependencies.sh')
type InstallResult = {
  code: number
  message: string
  signal?: NodeJS.Signals
  holdMs?: number
}
let fixture: string

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'install-download-'))
  fs.mkdirSync(path.join(fixture, 'bin'))
  fs.writeFileSync(
    path.join(fixture, 'bin/npm'),
    `#!/usr/bin/env node
const fs = require('node:fs')
const state = process.env.INSTALL_TEST_STATE
const count = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0
fs.writeFileSync(state, String(count + 1))
const results = JSON.parse(process.env.INSTALL_TEST_RESULTS)
const result = results[Math.min(count, results.length - 1)]
console.error(result.message)
const finish = () => result.signal ? process.kill(process.pid, result.signal) : process.exit(result.code)
if (result.holdMs) setTimeout(finish, result.holdMs)
else finish()
`,
    { mode: 0o755 }
  )
})

afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }))

function installEnvironment(results: InstallResult[], command = 'npm ci') {
  return {
    ...process.env,
    PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    INSTALL_COMMAND: command,
    INSTALL_RETRY_DELAY_SECONDS: '0',
    INSTALL_TEST_STATE: path.join(fixture, 'attempts'),
    INSTALL_TEST_RESULTS: JSON.stringify(results),
  }
}

function install(results: InstallResult[], command = 'npm ci') {
  const state = path.join(fixture, 'attempts')
  const result = spawnSync('bash', [installScript], {
    cwd: fixture,
    encoding: 'utf8',
    env: installEnvironment(results, command),
  })
  return { ...result, attempts: Number(fs.readFileSync(state, 'utf8')) }
}

describe('dependency download recovery', () => {
  it('recovers the Prisma download connection reset seen before Playwright started', () => {
    const result = install([
      { code: 1, message: "npm error code: 'ECONNRESET', retriesLeft: 2" },
      { code: 0, message: 'installed' },
    ])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
    expect(result.stdout).toContain('ECONNRESET')
    expect(result.stdout).toContain('::warning::')
  })

  it('keeps deterministic install errors red without retrying', () => {
    const result = install([
      { code: 1, message: 'npm error code EUSAGE: lockfile mismatch' },
    ])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('stops after three failed downloads and preserves the error', () => {
    const result = install([{ code: 1, message: 'npm error code ETIMEDOUT' }])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(3)
    expect(result.stdout).toContain('ETIMEDOUT')
  })

  it('runs custom commands containing tests once even when they report a network error', () => {
    const result = install([{ code: 1, message: 'ECONNRESET in a test' }], 'npm test')
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('leaves successful installs at one attempt', () => {
    const result = install([{ code: 0, message: 'installed' }])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(1)
  })

  it('preserves a terminated npm process without retrying', () => {
    const result = install([{ code: 143, message: 'ECONNRESET', signal: 'SIGTERM' }])
    expect(result.status).toBe(143)
    expect(result.attempts).toBe(1)
  })

  it('stops when the wrapper is interrupted during an install', async () => {
    const child = spawn('bash', [installScript], {
      cwd: fixture,
      env: installEnvironment([{ code: 1, message: 'ECONNRESET', holdMs: 1000 }]),
    })
    let interrupted = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (!interrupted && chunk.toString().includes('ECONNRESET')) {
        interrupted = child.kill('SIGINT')
      }
    })
    child.stderr.resume()
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve)
      child.once('error', reject)
    })
    expect(interrupted).toBe(true)
    expect(code).toBe(130)
    expect(fs.readFileSync(path.join(fixture, 'attempts'), 'utf8')).toBe('1')
  })

  it('preserves an interrupted retry delay', () => {
    fs.writeFileSync(path.join(fixture, 'bin/sleep'), '#!/bin/sh\nexit 143\n', {
      mode: 0o755,
    })
    const result = install([{ code: 1, message: 'ECONNRESET' }])
    expect(result.status).toBe(143)
    expect(result.attempts).toBe(1)
  })

  it('routes the shared install action through the recovery script', () => {
    const action = fs.readFileSync(
      path.join(repoRoot, '.github/actions/install/action.yml'),
      'utf8'
    )
    expect(action).toContain('INSTALL_COMMAND: ${{ inputs.install-command }}')
    expect(action).toContain(
      'run: bash "${{ github.action_path }}/../../../scripts/ci/install-dependencies.sh"'
    )
  })
})
