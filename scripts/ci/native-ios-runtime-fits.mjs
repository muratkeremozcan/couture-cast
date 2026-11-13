#!/usr/bin/env node
// Story 6.15 C-16: the iOS shards install a client built with Xcode 26 on the macos-15 iOS 18.5
// simulator. That holds only while the client's deployment target (MinimumOSVersion) is at most
// the runtime, so each consumer checks it before any flow and fails with both versions named.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const VERSION = /^\d+(\.\d+){0,2}$/

/** Whether an app whose minimum iOS is `minimum` runs on a simulator runtime of `runtime`. */
export function runtimeFits(minimum, runtime) {
  if (!VERSION.test(String(minimum)) || !VERSION.test(String(runtime)))
    throw new Error(`ios_version_required:${minimum}:${runtime}`)
  const [a, b] = [minimum, runtime].map((value) => String(value).split('.').map(Number))
  for (let at = 0; at < 3; at++) {
    const delta = (a[at] ?? 0) - (b[at] ?? 0)
    if (delta) return delta < 0
  }
  return true
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [minimum, runtime] = process.argv.slice(2)
  if (!runtimeFits(minimum, runtime)) {
    console.error(
      `::error::the development client needs iOS ${minimum}, but the simulator runtime is ${runtime}`
    )
    process.exitCode = 1
  } else
    console.log(
      `The development client (iOS ${minimum} and later) runs on iOS ${runtime}.`
    )
}
