/** Name the exact element each open-app run tapped to leave a pushed iOS stack screen. */
import fs from 'node:fs'
import path from 'node:path'

const OPEN_APP_FLOW = 'maestro/story65/open-app.yaml'

function commandFiles(directory) {
  let entries = []
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return commandFiles(file)
    return entry.name === 'commands.json' ? [file] : []
  })
}

/** Completed taps on the exact Back label, from the flow's own Maestro command trace. */
export function iosStackPopTaps(output) {
  let taps = 0
  for (const file of commandFiles(output)) {
    let rows
    try {
      rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const tap = (row?.metadata?.evaluatedCommand ?? row?.command)?.tapOnElement
      const selector = tap?.selector ?? {}
      if (
        row?.metadata?.status === 'COMPLETED' &&
        (selector.textRegex ?? selector.text) === 'Back'
      )
        taps++
    }
  }
  return taps
}

export function recordIosStackPop({
  platform,
  flow,
  output,
  directory,
  log = console.log,
}) {
  if (platform !== 'ios' || flow !== OPEN_APP_FLOW) return null
  const record = {
    version: 1,
    flow,
    element: { kind: 'text', value: 'Back' },
    completedTaps: iosStackPopTaps(output),
  }
  try {
    fs.writeFileSync(
      path.join(directory, 'native-ios-stack-pop.json'),
      JSON.stringify(record, null, 2) + '\n',
      { mode: 0o600 }
    )
  } catch (error) {
    log(JSON.stringify({ iosStackPopWriteFailure: { errorCode: error.code ?? null } }))
  }
  log(JSON.stringify({ iosStackPop: record }))
  return record
}
