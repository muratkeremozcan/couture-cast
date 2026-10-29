#!/usr/bin/env node
/** Release build services started inside this hosted job's native-build window. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ibtoold (Interface Builder) outlives the build and stays resident at about 100 MB per instance.
const SERVICES = new Set(['XCBBuildService', 'SWBBuildService', 'ibtoold'])

export function buildServices(text) {
  return text.split('\n').flatMap((line) => {
    const match = line
      .trim()
      .match(
        /^(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/
      )
    if (!match || !SERVICES.has(path.basename(match[3]))) return []
    const startedAt = Date.parse(match[2])
    if (!Number.isFinite(startedAt) || Number(match[1]) <= 1) return []
    return [{ pid: Number(match[1]), startedAt, executable: match[3] }]
  })
}

export function ownedBuildServices(before, after) {
  return after.filter(
    (row) =>
      row.startedAt > before.at && !before.services.some((old) => old.pid === row.pid)
  )
}

export function sameProcess(a, b) {
  return a.pid === b.pid && a.startedAt === b.startedAt && a.executable === b.executable
}

const snapshot = () => {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,lstart=,comm='], {
    encoding: 'utf8',
    timeout: 10000,
  })
  if (result.status !== 0) throw new Error('build_service_snapshot_failed')
  return buildServices(result.stdout)
}

async function main() {
  // New services are attributable by start time only on this job's disposable host.
  if (
    process.platform !== 'darwin' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('build_service_cleanup_requires_github_hosted_macos')
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  const file = path.join(directory, 'owned-build-services-private.json')
  if (process.argv[2] === 'mark') {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const services = snapshot()
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), services }), {
      mode: 0o600,
      flag: 'wx',
    })
    console.log(JSON.stringify({ buildServicesBaseline: services.length }))
  } else if (process.argv[2] === 'stop') {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'))
    const owned = ownedBuildServices(before, snapshot())
    let stopped = 0
    for (const row of owned) {
      if (!snapshot().some((now) => sameProcess(row, now))) continue
      try {
        process.kill(row.pid, 'SIGTERM')
        stopped++
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    const deadline = Date.now() + 5000
    let remaining
    do {
      remaining = snapshot().filter((now) => owned.some((row) => sameProcess(row, now)))
      if (!remaining.length) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    console.log(
      JSON.stringify({
        buildServicesStopped: stopped,
        buildServicesRemaining: remaining.length,
      })
    )
    if (remaining.length) throw new Error('owned_build_services_still_running')
  } else throw new Error('build_service_command_required')
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
