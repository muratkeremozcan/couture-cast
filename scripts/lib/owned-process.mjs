// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 TEA: a test that cleans up a process by a pid it read from a file (a stub's $$, a
// grandchild it never spawned itself) cannot know the process is still the one it started. Once
// that process exits, launchd or init reaps it and the pid is free for any new process, a sibling
// test file or the runner included, so a blind SIGKILL can end something unrelated. These helpers
// signal a pid, or the members of a process group, only while ps shows it alive (not a zombie)
// running the command the test expects. A direct child is better stopped through its ChildProcess
// (child.kill), which does nothing once Node has reaped it.
import { spawnSync } from 'node:child_process'

/** `ps -o pid=,pgid=,stat=,command=` output as [{ pid, pgid, command }], zombies left out. */
export function parseProcessTable(text) {
  return text
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter((match) => match && !match[3].startsWith('Z'))
    .map(([, pid, pgid, , command]) => ({
      pid: Number(pid),
      pgid: Number(pgid),
      command,
    }))
}

/** Live processes; [] when ps cannot run, so nothing is signalled. */
function processTable() {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,command='], {
    encoding: 'utf8',
    timeout: 5_000,
    killSignal: 'SIGKILL',
  })
  return ps.status === 0 ? parseProcessTable(ps.stdout) : []
}

/** Whether a command line contains `expected`, or any of a list of expected substrings. */
const runs = (command, expected) =>
  (Array.isArray(expected) ? expected : [expected]).some(
    (part) => part && command.includes(part)
  )

const signal = (pid, name) => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    // Gone between the check and the signal.
    return false
  }
}

/**
 * Signals `pid` only while it is alive and its command line contains `expected` (a string, or a
 * list of which any one will do). Returns whether a signal was sent.
 */
export function killOwned(pid, expected, name = 'SIGKILL', table = processTable) {
  if (!Number.isInteger(pid) || pid <= 0 || !expected) return false
  const entry = table().find((row) => row.pid === pid)
  return entry && runs(entry.command, expected) ? signal(pid, name) : false
}

/**
 * Signals each live member of process group `pgid` whose command line contains `expected`.
 * Returns how many were signalled.
 */
export function killOwnedGroup(pgid, expected, name = 'SIGKILL', table = processTable) {
  if (!Number.isInteger(pgid) || pgid <= 0 || !expected) return 0
  return table()
    .filter((row) => row.pgid === pgid && runs(row.command, expected))
    .filter((row) => signal(row.pid, name)).length
}
