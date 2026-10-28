/** Project live logging clients and parent chains without retaining command arguments. */
import path from 'node:path'

const safeName = (value) =>
  path
    .basename(value)
    .replace(/[^A-Za-z0-9._+-]/g, '_')
    .slice(0, 64)

function collectorKind(args, name) {
  if (/\bsimctl\s+diagnose\b/.test(args)) return 'simctl-diagnose'
  if (/\bsimctl\s+spawn\s+\S+\s+(?:\S*\/)?log\s/.test(args)) return 'simctl-log'
  const log = args.match(/(?:^|[\s/])log\s+(stream|collect|show|config)\b/)
  if (log) return `log-${log[1]}`
  if (/\bmaestro\b/i.test(args)) return 'maestro'
  if (/^(?:diagnosticd|logd|logd_helper|syslogd)$/.test(name)) return 'logging-daemon'
  if (
    /^(?:ReportCrash|spindump|osanalyticshelper|diagnostics_agent|diagnosticextensionsd)$/.test(
      name
    )
  )
    return 'diagnostic-service'
  if (/\b(?:node|python3?)\b.*scripts\/\S*(?:collect|diagnos|logs?)[^\s]*/.test(args))
    return 'harness-collector'
  if (
    /\bnode\b.*scripts\/(?:ci\/native-ios|ci\/native-host|run-story68-native)/.test(args)
  )
    return 'harness'
  if (/CoreSimulatorService|SimulatorTrampoline|SimLaunchHost/.test(name))
    return 'simulator-service'
  if (/^(?:tail|tee|Console)$/.test(name)) return 'file-log-reader'
  return null
}

export function simulatorCollectors(usage, commands, managerPid, harnessPid) {
  const names = new Map(
    usage.split('\n').flatMap((line) => {
      const m = line.trim().match(/^(\d+)\s+\d+\s+\d+(?:\.\d+)?\s+(.+)$/)
      return m ? [[Number(m[1]), safeName(m[2].trim())]] : []
    })
  )
  const rows = commands.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }] : []
  })
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const project = (row) => ({
    pid: row.pid,
    ppid: row.ppid,
    command: names.get(row.pid) ?? safeName(row.args.split(/\s/)[0]),
  })
  return rows.flatMap((row) => {
    const entry = project(row)
    const kind = collectorKind(row.args, entry.command)
    if (!kind) return []
    const seen = new Set([row.pid])
    const parents = []
    let parent = byPid.get(row.ppid)
    while (parent && !seen.has(parent.pid)) {
      seen.add(parent.pid)
      parents.push(project(parent))
      parent = byPid.get(parent.ppid)
    }
    return [
      {
        ...entry,
        kind,
        ownedSimulator:
          row.pid === managerPid || parents.some((p) => p.pid === managerPid),
        ownedByHarness:
          row.pid === harnessPid || parents.some((p) => p.pid === harnessPid),
        parents,
      },
    ]
  })
}
