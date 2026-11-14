// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (TEA hardening, 2026-11-13): where the Test Store journey writes. The evidence
// dir (--out) holds redacted records only: the report, the manifests. Everything raw goes to a
// sibling private dir, `<out>.private/` (mode 700, files 600): the member side file, Metro's
// log, the device log (logcat or the simulator's log stream, which can carry the RevenueCat app
// user id, our user id), Maestro's debug output and any APK pulled off the device. The run
// fails if any member, app user or subscriber id is found anywhere under the evidence dir.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { JourneyError } from './test-store-journey.mjs'

/** Creates both dirs; returns { evidence, private }. */
export function outputDirs(out) {
  const evidence = path.resolve(out)
  const dirs = { evidence, private: `${evidence}.private` }
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(dir, 0o700)
  }
  return dirs
}

/** A path inside the private dir. */
export const privatePath = (dirs, name) => path.join(dirs.private, name)

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    file,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 }
  )
  return file
}

export const writeEvidence = (dirs, name, value) =>
  write(path.join(dirs.evidence, name), value)
export const writePrivate = (dirs, name, value) => write(privatePath(dirs, name), value)

/**
 * Base64 and base64url substrings that any encoding of `text` inside a larger byte run must
 * contain, at each of the three byte alignments (a user id inside a JWT payload, for one).
 */
export function base64Fragments(text) {
  const bytes = Buffer.from(text, 'utf8')
  const fragments = []
  for (let offset = 0; offset < 3; offset += 1) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString('base64')
    const n = offset + bytes.length
    // Characters whose six bits come from the id's bytes alone.
    const fragment = encoded.slice(Math.ceil((offset * 4) / 3), Math.floor((n * 4) / 3))
    fragments.push(fragment, fragment.replaceAll('+', '-').replaceAll('/', '_'))
  }
  return fragments
}

const unicodeEscape = (text, upper) =>
  [...text]
    .map((char) => {
      const hex = char.charCodeAt(0).toString(16).padStart(4, '0')
      return `\\u${upper ? hex.toUpperCase() : hex}`
    })
    .join('')

/**
 * The forms an id can take in a file (Antigravity r12 P2): raw, URL-encoded once and twice, lower
 * and upper case, base64 and base64url at every alignment, and JSON `\\u` escapes.
 */
export function needleVariants(needle) {
  const raw = String(needle)
  const once = encodeURIComponent(raw)
  return [
    ...new Set([
      raw,
      raw.toLowerCase(),
      raw.toUpperCase(),
      once,
      encodeURIComponent(once),
      ...base64Fragments(raw),
      unicodeEscape(raw, false),
      unicodeEscape(raw, true),
    ]),
  ].filter((variant) => variant.length >= 8)
}

const variantPairs = (needles) =>
  needles
    .filter(Boolean)
    .flatMap((needle) =>
      needleVariants(needle).map((variant) => [variant, String(needle)])
    )

/** The needles `text` holds in any form, each once. */
export function leaksInText(text, needles) {
  const wanted = variantPairs(needles)
  return [
    ...new Set(wanted.filter(([variant]) => text.includes(variant)).map(([, n]) => n)),
  ]
}

/** Every file under `dir` whose contents hold one of `needles` in any form: [{ file, needle }]. */
export function scanForLeaks(dir, needles) {
  const hits = []
  const walk = (current) => {
    // Dirents come from lstat: a symlink is never followed, into a dir or out of the tree.
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      const relative = path.relative(dir, file)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) {
        const text = fs.readFileSync(file).toString('latin1')
        for (const needle of leaksInText(text, needles))
          hits.push({ file: relative, needle })
      } else
        // A symlink (or any other non-regular entry) could expose what it points at; it is
        // quarantined whatever it names (Antigravity r14).
        hits.push({ file: relative, needle: null, kind: 'non-regular' })
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return hits
}

/** The fs calls a quarantine move makes; tests inject failures through them. */
export const FS_OPS = Object.freeze({
  rename: (from, to) => fs.renameSync(from, to),
  copyFile: (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL),
  chmod: (file, mode) => fs.chmodSync(file, mode),
  unlink: (file) => fs.unlinkSync(file),
  symlink: (target, file) => fs.symlinkSync(target, file),
})

/** Removes the evidence copy; when even that fails, the error says the file is still there. */
function removeFromEvidence(from, ops) {
  try {
    ops.unlink(from)
  } catch (error) {
    throw new JourneyError(
      'test_store_quarantine_failed',
      `${from} is still in the evidence dir (${error.code ?? error.message})`
    )
  }
}

/**
 * Moves `from` to `to`. Across mounts (EXDEV: the evidence dir on its own volume) it copies,
 * keeping mode 600 for a file and recreating a symlink as a symlink, then removes the source.
 * A leak must never stay behind (Antigravity r15): when the rename fails for another reason, or
 * the copy or chmod fails, the source is removed anyway (the private copy is a nicety) and the
 * original error is thrown; a source that cannot be removed throws test_store_quarantine_failed.
 */
export function moveAcrossMounts(from, to, ops = FS_OPS) {
  try {
    ops.rename(from, to)
    return
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      removeFromEvidence(from, ops)
      throw error
    }
  }
  try {
    if (fs.lstatSync(from).isSymbolicLink()) ops.symlink(fs.readlinkSync(from), to)
    else {
      ops.copyFile(from, to)
      ops.chmod(to, 0o600)
    }
  } catch (error) {
    removeFromEvidence(from, ops)
    throw error
  }
  removeFromEvidence(from, ops)
}

// One run id per process plus a counter: a reused out dir never meets an earlier entry's name.
const RUN_ID = `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
let quarantined = 0

/** A fresh quarantine path for `file` (relative to the evidence dir). */
export function quarantineTarget(dirs, file) {
  quarantined += 1
  return privatePath(dirs, path.join('quarantine', `${RUN_ID}-${quarantined}`, file))
}

/**
 * Moves every leaking or non-regular entry under the evidence dir into its own fresh directory
 * under `<private>/quarantine/`, so an always-run upload of the evidence dir never carries it
 * (Antigravity r13 P2). Returns the moved paths, relative to the evidence dir.
 */
export function quarantineLeaks(dirs, needles, { ops = FS_OPS } = {}) {
  const files = [...new Set(scanForLeaks(dirs.evidence, needles).map((hit) => hit.file))]
  const failures = []
  for (const file of files) {
    const target = quarantineTarget(dirs, file)
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    try {
      moveAcrossMounts(path.join(dirs.evidence, file), target, ops)
    } catch (error) {
      failures.push(error)
    }
  }
  if (!failures.length) return files
  // Every entry was attempted. Whatever is still in the evidence dir is named in one error, the
  // originals attached; only when nothing remains does the first original error stand alone
  // (Antigravity r16).
  const remaining = files.filter((file) => exists(path.join(dirs.evidence, file)))
  if (remaining.length)
    throw new JourneyError(
      'test_store_quarantine_failed',
      `${remaining.join(', ')} still in the evidence dir`,
      { cause: new AggregateError(failures, 'quarantine move failures') }
    )
  throw failures[0]
}

const exists = (file) => {
  try {
    fs.lstatSync(file)
    return true
  } catch {
    return false
  }
}

export const TEARDOWN_WAIT_MS = 3_000

/**
 * The pids (a negative pid: every member of that process group) still running. A child the
 * driver spawned stays a zombie until Node reaps it, which cannot happen while the exit path
 * holds the thread, so a zombie counts as exited; `ps` reports it with state Z.
 */
export function stillRunning(pids) {
  if (!pids.length) return []
  const table = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' })
  if (table.status !== 0)
    // No ps: fall back to signal 0, which counts a zombie as running (the wait just runs long).
    return pids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return error.code === 'EPERM'
      }
    })
  const live = table.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([pid, , stat]) => pid && stat && !stat.startsWith('Z'))
    .map(([pid, pgid]) => ({ pid: Number(pid), pgid: Number(pgid) }))
  return pids.filter((pid) =>
    live.some((entry) => (pid < 0 ? entry.pgid === -pid : entry.pid === pid))
  )
}

/** Sleeps the thread: the exit path cannot wait on timers. */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Waits, synchronously, for `pids` to exit; SIGKILLs whatever is left at the deadline. */
export function awaitExit(pids, waitMs = TEARDOWN_WAIT_MS) {
  const deadline = Date.now() + waitMs
  let left = stillRunning(pids)
  while (left.length && Date.now() < deadline) {
    sleepSync(50)
    left = stillRunning(left)
  }
  for (const pid of left) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Gone between the check and the kill.
    }
  }
  return left
}

/**
 * Scans and quarantines the evidence dir on every exit of the process (Antigravity r16): a
 * normal end, an uncaught exception, process.exit, and SIGINT or SIGTERM (which exit 130 or 143
 * through the same path). The quarantine is synchronous, so it runs inside Node's 'exit' event.
 * The original failure stays the exit cause; a leak found on an otherwise passing exit sets exit
 * code 1. `ids` is read at exit, so the caller can push ids as they become known.
 *
 * Signal handlers stay installed (`on`, with an exiting flag): with `once`, Node restores the
 * default action after the first signal, and a second Ctrl-C during the scan would kill the
 * process with leaks left behind (Antigravity r17). Teardowns (Metro's process group, a log
 * stream, adb reverse) registered with `teardown` run synchronously on exit before the scan, so
 * no child can write into the evidence dir after it was scanned (TEA, r18). A teardown may name
 * the pids (a negative pid is a process group) it stops; the guard waits for them to exit, up to
 * TEARDOWN_WAIT_MS, then sends SIGKILL. Each teardown runs at most once, so the normal path can
 * call `runTeardowns` before its own scan too.
 *
 * Returns { teardown(name, fn, { pids }), runTeardowns(), uninstall() }.
 */
export function installEvidenceGuard({
  dirs,
  ids,
  ops,
  proc = process,
  waitMs = TEARDOWN_WAIT_MS,
  kill = (pid, signal) => process.kill(pid, signal),
}) {
  const teardowns = []
  let exiting = false
  const runTeardowns = () => {
    const pids = []
    for (const entry of teardowns) {
      if (entry.done) continue
      entry.done = true
      try {
        entry.fn()
      } catch (error) {
        proc.stderr.write(`test_store_teardown_failed: ${entry.name}: ${error.message}\n`)
      }
      // After fn: a child teardown decides its targets when it runs.
      pids.push(...(typeof entry.pids === 'function' ? entry.pids() : entry.pids))
    }
    awaitExit(pids, waitMs)
  }
  const onExit = (code) => {
    exiting = true
    // Stop every child first: one still running could write into evidence after the scan.
    runTeardowns()
    try {
      const moved = quarantineLeaks(dirs, [...ids], { ops })
      if (moved.length) {
        proc.stderr.write(`test_store_evidence_leak: quarantined ${moved.join(', ')}\n`)
        if (!code) proc.exitCode = 1
      }
    } catch (error) {
      proc.stderr.write(`${error.message}\n`)
      if (!code) proc.exitCode = 1
    }
  }
  const onSignal = (code) => () => {
    // A repeat signal while the exit path runs is ignored; the first one decided the code.
    if (exiting) return
    exiting = true
    proc.exit(code)
  }
  const onSigint = onSignal(130)
  const onSigterm = onSignal(143)
  proc.once('exit', onExit)
  proc.on('SIGINT', onSigint)
  proc.on('SIGTERM', onSigterm)
  return {
    teardown: (name, fn, { pids = [] } = {}) => {
      teardowns.push({ name, fn, pids, done: false })
    },
    /**
     * Stops a spawned child on teardown (Antigravity r19). A child that already exited is
     * dropped at its exit event, so its pid, which the OS may hand to another process, is never
     * signalled. With `group`, the child leads its own process group (spawned detached): the
     * group is signalled, and waited on, only while `ps` still shows a member of it.
     */
    child: (name, child, { group = false } = {}) => {
      const pid = child.pid
      let exited = false
      child.once('exit', () => {
        exited = true
      })
      const target = () => {
        if (group) return stillRunning([-pid]).length ? [-pid] : []
        return exited ? [] : [pid]
      }
      let targets = []
      teardowns.push({
        name,
        done: false,
        pids: () => targets,
        fn: () => {
          targets = target()
          for (const each of targets) {
            try {
              kill(each, 'SIGTERM')
            } catch {
              // Gone between the check and the signal.
            }
          }
        },
      })
    },
    runTeardowns,
    uninstall: () => {
      proc.removeListener('exit', onExit)
      proc.removeListener('SIGINT', onSigint)
      proc.removeListener('SIGTERM', onSigterm)
    },
  }
}

/** Throws, naming files but never the ids, after quarantining every leak under the evidence dir. */
export function assertEvidenceClean(dirs, needles, options) {
  const files = quarantineLeaks(dirs, needles, options)
  if (files.length) throw new JourneyError('test_store_evidence_leak', files.join(', '))
}

/**
 * The run's closing writes. The member side file goes to the private dir. Every leak already
 * under the evidence dir is quarantined first; the report is serialized and scanned in memory and
 * reaches the evidence dir only when it and the dir are clean. Returns the written paths.
 */
export function writeRunOutputs({ dirs, label, report, member, extraIds = [], ops }) {
  const needles = [member?.userId, ...extraIds]
  const written = {}
  if (member)
    written.member = writePrivate(dirs, `${label}.member.json`, { userId: member.userId })
  const moved = quarantineLeaks(dirs, needles, { ops })
  const text = `${JSON.stringify(report, null, 2)}\n`
  const reportLeaks = leaksInText(text, needles).length > 0
  if (moved.length || reportLeaks)
    throw new JourneyError(
      'test_store_evidence_leak',
      [...moved, ...(reportLeaks ? [`${label}.json (not written)`] : [])].join(', ')
    )
  written.report = writeEvidence(dirs, `${label}.json`, text)
  assertEvidenceClean(dirs, needles, { ops })
  return written
}
