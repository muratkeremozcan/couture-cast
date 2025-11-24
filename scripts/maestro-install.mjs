#!/usr/bin/env node
import { execSync } from 'node:child_process'

const log = (msg) => console.log(`[maestro:install] ${msg}`)

const commandExists = (cmd) => {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const run = (cmd, options = {}) => {
  log(`Executing: ${cmd}`)
  execSync(cmd, { stdio: 'inherit', shell: true, ...options })
}

try {
  if (commandExists('maestro')) {
    log('Maestro CLI already installed. Skipping installation.')
    process.exit(0)
  }

  if (process.platform === 'darwin' && commandExists('brew')) {
    try {
      run('brew install maestro')
    } catch (brewError) {
      log('Homebrew core formula missing. Adding official Maestro tap.')
      run('brew tap mobile-dev-inc/tap')
      run('brew install mobile-dev-inc/tap/maestro')
    }
  } else if (process.platform === 'linux') {
    run('curl -Ls \"https://get.maestro.mobile.dev\" | bash')
  } else if (process.platform === 'win32') {
    log('Installing maestro via npm fallback on Windows')
    run('npx maestro@latest --version')
  } else {
    log('Unknown platform. Attempting curl installer fallback.')
    run('curl -Ls \"https://get.maestro.mobile.dev\" | bash')
  }

  log('Maestro CLI installation step finished.')
} catch (error) {
  console.error('[maestro:install] Failed to install Maestro CLI.')
  console.error(error.message)
  process.exit(1)
}
