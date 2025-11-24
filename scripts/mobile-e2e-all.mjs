#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(repoRoot, '..')

const log = (msg) => console.log(`[mobile-e2e] ${msg}`)

const run = (cmd, args = [], opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      cwd: projectRoot,
      ...opts,
    })
    child.on('exit', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`${cmd} exited with code ${code}`))
    })
    child.on('error', reject)
  })

const tryStep = async (label, fn) => {
  try {
    await fn()
    return true
  } catch (err) {
    log(`${label} skipped: ${err.message}`)
    return false
  }
}

const bootEmulator = async () => {
  const androidOk = await tryStep('android emulator', () =>
    run('bash', ['./scripts/start-android-emulator.sh'])
  )
  if (androidOk) return
  await tryStep('ios simulator', () => run('bash', ['./scripts/start-ios-simulator.sh']))
}

const main = async () => {
  log('Installing Maestro CLI if needed')
  await run('npm', ['run', 'maestro:install', '--silent'])

  log('Booting simulator/emulator (android preferred)')
  await bootEmulator()

  log('Running Maestro smoke (starts Expo server automatically)')
  await run('node', ['./scripts/run-maestro.mjs', 'maestro/sanity.yaml'])
}

main().catch((err) => {
  console.error('[mobile-e2e] failed', err)
  process.exit(1)
})
