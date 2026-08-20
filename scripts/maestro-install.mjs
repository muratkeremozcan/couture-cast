#!/usr/bin/env node
/**
 * Install a pinned Maestro CLI, the same version everywhere.
 *
 * This used to `brew install maestro` on macOS and pipe get.maestro.mobile.dev
 * into bash on Linux, with no version in either. That is how local ended up on
 * 2.0.10 while CI ran whatever the installer served that day, eight releases
 * ahead, with nothing reporting the difference. The mobile workflow even
 * explained that it did not want "a floating Maestro version that no developer
 * runs locally", and then asserted only that some `maestro` was on PATH.
 *
 * The official installer honours `MAESTRO_VERSION`, so it is used on macOS as
 * well as Linux. Homebrew cannot pin a version, which is the whole reason it is
 * no longer used here.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import {
  MAESTRO_BIN,
  MAESTRO_PINNED_VERSION as PINNED_VERSION,
} from './maestro-version.mjs'

const log = (msg) => console.log(`[maestro:install] ${msg}`)

const capture = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

const run = (cmd, options = {}) => {
  log(`Executing: ${cmd}`)
  execSync(cmd, { stdio: 'inherit', shell: true, ...options })
}

/**
 * @param {string} binary
 * @returns {string | null}
 */
const versionOf = (binary) => {
  const raw = capture(`"${binary}" --version 2>/dev/null`)
  if (!raw) return null
  // The CLI prints a bare version on its own line; take the first thing that
  // looks like one so a banner or update notice cannot break the check.
  return raw.split(/\s+/).find((token) => /^\d+\.\d+\.\d+$/.test(token)) ?? null
}

try {
  const onPath = capture('command -v maestro')
  const currentVersion = onPath ? versionOf(onPath) : null

  if (currentVersion === PINNED_VERSION) {
    log(`Maestro ${PINNED_VERSION} already installed at ${onPath}`)
    process.exit(0)
  }

  if (currentVersion) {
    log(
      `Found Maestro ${currentVersion} at ${onPath}, but this repo pins ${PINNED_VERSION}`
    )
  }

  if (process.platform === 'win32') {
    // No official installer for Windows; npx can at least honour the pin.
    //
    // Returning here rather than falling through to the check below, which reads
    // `~/.maestro/bin/maestro`. npx runs the package out of its own cache and
    // never writes that path, so every Windows run reached the check, found
    // nothing, and exited 1 immediately after the pinned command had succeeded.
    // `runMaestroCommand` in `scripts/run-maestro.mjs` falls back to the same
    // pinned npx invocation, so this is a complete delivery on Windows even
    // though nothing lands on disk.
    run(`npx maestro@${PINNED_VERSION} --version`)
    log(`Maestro ${PINNED_VERSION} available through npx`)
    process.exit(0)
  } else {
    // What matters is the version, not who installed it. The official installer
    // refuses to run while a Homebrew maestro exists, and uninstalling someone's
    // brew package to satisfy this script is the wrong trade when brew can
    // already reach the pin, so try that first on macOS.
    const brewOwnsIt = onPath?.includes('/Cellar/') || onPath?.includes('/homebrew/')
    let satisfied = false
    if (process.platform === 'darwin' && brewOwnsIt) {
      try {
        run('brew upgrade mobile-dev-inc/tap/maestro')
        satisfied = versionOf(onPath) === PINNED_VERSION
      } catch {
        log('brew upgrade did not reach the pinned version.')
      }
      if (satisfied) {
        log(`Maestro ${PINNED_VERSION} in place at ${onPath}`)
        process.exit(0)
      }
      console.error(
        `[maestro:install] Homebrew cannot provide ${PINNED_VERSION}, and the official ` +
          'installer refuses to run alongside a brew install. Run `brew uninstall maestro` ' +
          'and re-run this script.'
      )
      process.exit(1)
    }
    run(
      `curl -Ls "https://get.maestro.mobile.dev" | MAESTRO_VERSION=${PINNED_VERSION} bash`
    )
  }

  const installedVersion = versionOf(MAESTRO_BIN)
  if (installedVersion !== PINNED_VERSION) {
    console.error(
      `[maestro:install] Installed ${installedVersion ?? 'nothing'} at ${MAESTRO_BIN}, expected ${PINNED_VERSION}.`
    )
    process.exit(1)
  }
  log(`Maestro ${PINNED_VERSION} installed at ${MAESTRO_BIN}`)

  // A Homebrew-installed maestro earlier on PATH would shadow the pinned one
  // and silently reintroduce the drift this script exists to remove. Say so
  // rather than leaving it to be discovered through a version-specific bug.
  const stillResolves = capture('command -v maestro')
  if (stillResolves && stillResolves !== MAESTRO_BIN) {
    const shadowVersion = versionOf(stillResolves)
    if (shadowVersion !== PINNED_VERSION) {
      log(
        `WARNING: ${stillResolves} (${shadowVersion ?? 'unknown'}) comes first on PATH and ` +
          'shadows the pinned binary. Remove it (`brew uninstall maestro`) or put ' +
          `${path.dirname(MAESTRO_BIN)} ahead of it on PATH.`
      )
    }
  }
} catch (error) {
  console.error('[maestro:install] Failed to install Maestro CLI.')
  console.error(error.message)
  process.exit(1)
}
