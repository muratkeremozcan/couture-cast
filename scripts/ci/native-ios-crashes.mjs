/** Read crash metadata on the disposable VM without starting a system-log client. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const name = (value) =>
  typeof value === 'string' ? value.replace(/[^A-Za-z0-9._+-]/g, '_').slice(0, 100) : null
const date = (value) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}
const integer = (value) => (Number.isSafeInteger(value) ? value : null)

export function crashMetadata(text) {
  let header = {}
  let body = {}
  try {
    body = JSON.parse(text)
  } catch {
    const newline = text.indexOf('\n')
    try {
      header = JSON.parse(text.slice(0, newline))
    } catch {
      /* Legacy crash text. */
    }
    try {
      body = JSON.parse(text.slice(newline + 1))
    } catch {
      /* Legacy crash text. */
    }
  }
  const legacy = text.match(/^Process:\s+(.+?)\s+\[(\d+)\]/m)
  const processName = name(body.procName ?? header.app_name ?? legacy?.[1])
  const timestamp = date(
    body.captureTime ?? header.timestamp ?? text.match(/^Date\/Time:\s+(.+)$/m)?.[1]
  )
  return {
    processName,
    pid: integer(body.pid ?? (legacy ? Number(legacy[2]) : null)),
    parentProcess: name(body.parentProc),
    parentPid: integer(body.parentPid),
    timestamp,
    exceptionType: name(
      body.exception?.type ?? text.match(/^Exception Type:\s+(\S+)/m)?.[1]
    ),
    signal: name(body.exception?.signal),
    terminationNamespace: name(body.termination?.namespace),
    terminationCode: integer(body.termination?.code),
    parsed: processName !== null,
  }
}

export function crashReportCollector(device, { home = os.homedir() } = {}) {
  if (device !== null && !/^[A-Fa-f0-9-]{36}$/.test(device))
    throw new Error('owned_device_uuid_required')
  const roots = [
    ...(device === null
      ? []
      : [
          [
            'simulator',
            path.join(
              home,
              'Library/Developer/CoreSimulator/Devices',
              device,
              'data/Library/Logs/DiagnosticReports'
            ),
          ],
        ]),
    ['host', path.join(home, 'Library/Logs/DiagnosticReports')],
  ]
  const known = new Map()
  const reports = []
  return (elapsedSeconds) => {
    const sources = roots.map(([source, directory]) => {
      let files = 0
      let errorCode = null
      const errors = []
      const failed = (operation, error) => {
        errorCode ??= error.code ?? 'READ_FAILED'
        errors.push({
          operation,
          errorCode: error.code ?? null,
          errorName: error.name,
          errorMessage: error.message,
          exitCode: null,
          stderr: '',
        })
      }
      const visit = (dir) => {
        let entries
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch (error) {
          failed('read-directory', error)
          return
        }
        for (const entry of entries) {
          const file = path.join(dir, entry.name)
          // Retired crash reports remain evidence; symlinks never leave the two roots.
          if (entry.isDirectory()) {
            visit(file)
            continue
          }
          if (!entry.isFile() || !/\.(?:ips|crash)$/.test(entry.name)) continue
          files++
          try {
            const stat = fs.statSync(file)
            const identity = `${stat.size}:${stat.mtimeMs}`
            if (known.get(file) === identity) continue
            const metadata = crashMetadata(fs.readFileSync(file, 'utf8'))
            const report = {
              source,
              observedSeconds: elapsedSeconds,
              modifiedAt: stat.mtime.toISOString(),
              ...metadata,
            }
            const previous = reports.findIndex((r) => r.id === known.get(file + ':id'))
            if (previous === -1) {
              report.id = reports.length + 1
              reports.push(report)
              known.set(file + ':id', report.id)
            } else reports[previous] = { ...report, id: reports[previous].id }
            known.set(file, identity)
          } catch (error) {
            failed('read-report', error)
          }
        }
      }
      visit(directory)
      return { source, files, errorCode, errors }
    })
    const counts = new Map()
    for (const r of reports) {
      const key = `${r.source}:${r.processName}`
      const count = counts.get(key) ?? {
        source: r.source,
        processName: r.processName,
        count: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      }
      count.count++
      if (r.timestamp) {
        if (!count.firstTimestamp || r.timestamp < count.firstTimestamp)
          count.firstTimestamp = r.timestamp
        if (!count.lastTimestamp || r.timestamp > count.lastTimestamp)
          count.lastTimestamp = r.timestamp
      }
      counts.set(key, count)
    }
    return { sources, reports: [...reports], counts: [...counts.values()] }
  }
}
