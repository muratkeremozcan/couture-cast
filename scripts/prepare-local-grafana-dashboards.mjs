import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// The checked-in dashboard JSON comes from Grafana Cloud exports, which preserve the long
// cloud datasource UIDs. Local Grafana provisioning rejects those UIDs and our local stack uses
// short repo-owned datasource names instead, so we rewrite them into generated throwaway copies
// at startup instead of forking the real dashboard JSON into a second local-only version.

const sourceDir = path.resolve('infra/grafana/dashboards')
const outputDir = path.resolve('infra/grafana/local/generated-dashboards')

const replacements = new Map([
  ['grafanacloud-couturecastobservability-prom', 'couturecast-prom'],
  ['grafanacloud-couturecastobservability-traces', 'couturecast-traces'],
])

async function main() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const sourcePath = path.join(sourceDir, entry.name)
    let content = await readFile(sourcePath, 'utf8')

    for (const [from, to] of replacements) {
      content = content.split(from).join(to)
    }

    await writeFile(path.join(outputDir, entry.name), content)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
