import fs from 'node:fs'
import path from 'node:path'

/** Private read-only simulator ingress. No focus request is issued by this reader. */
export function story68FocusObservationHandler({
  device,
  appId,
  readContainer,
  readFile = fs.readFileSync,
}) {
  if (appId !== 'com.couturecast.story68' || !/^[A-Fa-f0-9-]{36}$/.test(device))
    throw new Error('owned_ios_focus_observation_required')
  return (request, response) => {
    if (request.url !== '/focus-observation') return false
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return true
    }
    try {
      const directory = readContainer().trim()
      if (
        !path.isAbsolute(directory) ||
        !directory.includes(`/Devices/${device}/data/Containers/Data/Application/`)
      )
        throw new Error('owned_container_required')
      const record = JSON.parse(
        readFile(path.join(directory, 'Documents/cc68-focus-observation.json'), 'utf8')
      )
      if (
        !/^[a-f0-9-]{36}$/i.test(record.session) ||
        !Number.isSafeInteger(record.sequence) ||
        record.sequence < 0 ||
        !['identifier', 'label'].every((key) => typeof record[key] === 'string') ||
        !['posted', 'attached', 'header'].every(
          (key) => typeof record[key] === 'boolean'
        ) ||
        !Array.isArray(record.headings) ||
        !record.headings.every((label) => typeof label === 'string')
      )
        throw new Error('invalid_record')
      const { session, sequence, identifier, label, posted, attached, header, headings } =
        record
      response
        .writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        .end(
          JSON.stringify({
            session,
            sequence,
            identifier,
            label,
            posted,
            attached,
            header,
            headings,
          })
        )
    } catch {
      response.writeHead(503).end()
    }
    return true
  }
}
