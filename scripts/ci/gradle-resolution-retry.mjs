#!/usr/bin/env node
// Runs a Gradle command and retries it when it fails on a transient download error: a 429 from
// Maven Central or the Gradle plugin portal, a 5xx, or a dropped connection. PR 238's run
// 43767969866 failed the modal system bars module before any test ran, because both registries
// answered 429 for gson, a dependency of the foojay toolchain resolver plugin. The signature and
// the bounded retry live in scripts/lib/transient-resolution-retry.cjs, which the share-card
// merger proof uses too; any other failure (a compile error, a failing test) fails at once.
//
// The command's output streams to the step log as it runs and is also kept, so the retry can
// read the error Gradle printed.
//
//   node scripts/ci/gradle-resolution-retry.mjs -- ./gradlew :module:testDebugUnitTest ...
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWithResolutionRetry } from '../lib/transient-resolution-retry.cjs'

/** The command and its arguments after `--`. */
export function parseArgs(argv) {
  const split = argv.indexOf('--')
  const command = split < 0 ? [] : argv.slice(split + 1)
  if (split !== 0 || command.length === 0)
    throw new Error('Usage: gradle-resolution-retry.mjs -- <command> [arguments...]')
  return command
}

/**
 * Runs the command once, its stdout and stderr streamed to this process's stdout through `tee`
 * and kept in a temporary file, and returns a spawnSync-like result with the kept output.
 */
export function runOnce(command, { spawn = spawnSync } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-resolution-retry-'))
  const output = path.join(directory, 'output.log')
  try {
    const result = spawn(
      'bash',
      [
        '-o',
        'pipefail',
        '-c',
        '"$@" 2>&1 | tee "$GRADLE_RESOLUTION_RETRY_OUTPUT"',
        'gradle-resolution-retry',
        ...command,
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, GRADLE_RESOLUTION_RETRY_OUTPUT: output },
      }
    )
    if (result.error) throw result.error
    return {
      status: result.status,
      signal: result.signal,
      stdout: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
      stderr: '',
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

/** Runs the command with the shared retry; returns the exit status of the last attempt. */
export function runGradleWithResolutionRetry(
  argv,
  {
    spawn = spawnSync,
    wait,
    delaysMs,
    log = (message) => console.log(`::warning::${message}`),
  } = {}
) {
  const command = parseArgs(argv)
  const result = runWithResolutionRetry(() => runOnce(command, { spawn }), {
    log,
    ...(wait ? { wait } : {}),
    ...(delaysMs ? { delaysMs } : {}),
  })
  return result.status ?? 1
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = runGradleWithResolutionRetry(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
