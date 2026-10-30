/**
 * What Expo Go did while it loaded the owned project, as counts only. The Expo Go app log, the
 * Metro log and the socket table are private; this keeps the numbers a public job log and the
 * public evidence directory may carry: the Expo Go version, Metro bundle completions and
 * failures, TCP sockets to Metro by state and Expo Go log lines by fixed families. No message,
 * address, path or identifier is kept.
 *
 * Runs 40992501585 to 41019906459 left Expo Go on its loading screen while Metro answered a
 * manifest and a warm bundle in 0.8 s, and no public record said what Expo Go was waiting for.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const EXPO_GO_PROBE_FILE = 'native-ios-expo-go-probe.json'
export const METRO_PORT = 8089

/** Fixed families an Expo Go log line is counted under; a line may count under several. */
export const EXPO_GO_LOG_FAMILIES = Object.freeze({
  network:
    /NSURLError|CFNetwork|nw_(?:connection|socket|endpoint)|could not connect|timed out|offline|App Transport Security|\bATS\b/i,
  manifest: /manifest|expo-updates|EXUpdates|EXManifests/i,
  bundle: /\.bundle\b|download\w* (?:the )?(?:js|javascript|bundle)|BundleURL/i,
  hermes: /hermes|bytecode|HBC/i,
  javascript:
    /Unhandled JS Exception|RCTFatal|JavaScript (?:error|exception)|RCTJSError/i,
  memory: /jetsam|low memory|memory pressure|out of memory/i,
})

/** Counts of ndjson log lines by level and by family; the text is read and dropped. */
export function summarizeExpoGoLog(ndjson) {
  const summary = {
    lines: 0,
    error: 0,
    fault: 0,
    families: Object.fromEntries(
      Object.keys(EXPO_GO_LOG_FAMILIES).map((key) => [key, 0])
    ),
  }
  for (const line of String(ndjson ?? '').split('\n')) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row || typeof row !== 'object' || typeof row.messageType !== 'string') continue
    summary.lines++
    if (row.messageType === 'Error') summary.error++
    if (row.messageType === 'Fault') summary.fault++
    const message = String(row.eventMessage ?? '')
    for (const [family, pattern] of Object.entries(EXPO_GO_LOG_FAMILIES))
      if (pattern.test(message)) summary.families[family]++
  }
  return summary
}

/** TCP sockets that have Metro's port on either end, by state; Metro's own listener is left out. */
export function metroSocketStates(netstat, port = METRO_PORT) {
  const states = {}
  for (const line of String(netstat ?? '').split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (!fields[0]?.startsWith('tcp')) continue
    const [local, foreign, state] = [fields[3], fields[4], fields[5]]
    if (!state || state === 'LISTEN') continue
    if (![local, foreign].some((address) => address?.endsWith(`.${port}`))) continue
    states[state] = (states[state] ?? 0) + 1
  }
  return states
}

/** Bundle completions and failures in Metro's log text. */
export function metroLogCounts(text) {
  const log = String(text ?? '')
  return {
    bundled: (log.match(/Bundled \d+ms/g) ?? []).length,
    failed: (log.match(/Bundling failed|Unable to resolve module|SyntaxError/g) ?? [])
      .length,
  }
}

const delta = (after, before) => ({
  bundled: after.bundled - before.bundled,
  failed: after.failed - before.failed,
})

/** The Expo Go version of a downloaded app: its CFBundleShortVersionString, else null. */
export function readExpoGoVersion(app, { spawn = spawnSync } = {}) {
  try {
    const result = spawn(
      'plutil',
      [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        path.join(app, 'Info.plist'),
      ],
      { encoding: 'utf8', timeout: 10000 }
    )
    const version = String(result.stdout ?? '').trim()
    return result.status === 0 && /^\d+\.\d+\.\d+$/.test(version) ? version : null
  } catch {
    return null
  }
}

/**
 * Takes the Metro log baseline before the exp:// link is sent; `finish()` records the counts
 * once the open flow ended, passed or failed. Nothing here can fail the proof.
 */
export function beginExpoGoProbe({
  directory,
  device,
  version,
  spawn = spawnSync,
  report = console.log,
}) {
  const metroLog = path.join(directory, 'metro.log')
  const read = () => {
    try {
      return metroLogCounts(fs.readFileSync(metroLog, 'utf8'))
    } catch {
      return { bundled: 0, failed: 0 }
    }
  }
  const before = read()
  const started = Date.now()
  const sockets = () => {
    try {
      const result = spawn('netstat', ['-an', '-p', 'tcp'], {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
      })
      return result.status === 0 ? metroSocketStates(result.stdout) : null
    } catch {
      return null
    }
  }
  const expoGoLog = () => {
    try {
      const result = spawn(
        'xcrun',
        [
          'simctl',
          'spawn',
          device,
          'log',
          'show',
          '--last',
          '5m',
          '--style',
          'ndjson',
          '--predicate',
          'process == "Expo Go"',
        ],
        {
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 128 * 1024 * 1024,
          killSignal: 'SIGKILL',
        }
      )
      return result.status === 0 ? summarizeExpoGoLog(result.stdout) : null
    } catch {
      return null
    }
  }
  return {
    finish() {
      try {
        const record = {
          version: 1,
          expoGoVersion: version ?? null,
          secondsSinceOpen: Math.round((Date.now() - started) / 1000),
          metro: delta(read(), before),
          metroSockets: sockets(),
          expoGoLog: expoGoLog(),
        }
        fs.writeFileSync(
          path.join(directory, EXPO_GO_PROBE_FILE),
          JSON.stringify(record),
          {
            mode: 0o600,
          }
        )
        report(JSON.stringify({ expoGoProbe: record }))
      } catch (error) {
        report(JSON.stringify({ expoGoProbeFailure: { errorCode: error.code ?? null } }))
      }
    },
  }
}
