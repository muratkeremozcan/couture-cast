import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const registries = ['ghcr.io', 'public.ecr.aws', 'docker.io']
function regular(file, maximum = 10 * 1024 ** 3) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum)
    throw new Error('invalid_supabase_image_artifact')
}
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function currentFiles(directory) {
  const archive = path.join(directory, 'images.tar.zst')
  const registryFile = path.join(directory, 'registry')
  regular(archive)
  regular(registryFile, 64)
  const registry = fs.readFileSync(registryFile, 'utf8').trim()
  if (!registries.includes(registry)) throw new Error('invalid_supabase_image_artifact')
  return { archive, registry, sha256: await digest(archive) }
}
export async function packSupabaseArtifact(directory) {
  const { registry, sha256 } = await currentFiles(directory)
  const target = path.join(directory, 'image-artifact.json')
  try {
    regular(target, 1024)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const metadata = { version: 1, architecture: 'amd64', registry, sha256 }
  fs.writeFileSync(target, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 })
  return metadata
}
export async function loadSupabaseArtifact(
  directory,
  load = (archive) => {
    const result = spawnSync(
      '/bin/bash',
      ['-c', 'set -o pipefail; zstd -dc "$1" | docker load', 'cc68-image-load', archive],
      { stdio: 'inherit', timeout: 600000, killSignal: 'SIGTERM' }
    )
    if (result.error || result.status !== 0)
      throw new Error('supabase_image_artifact_load_failed')
  }
) {
  const target = path.join(directory, 'image-artifact.json')
  regular(target, 1024)
  let metadata
  try {
    metadata = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch {
    throw new Error('invalid_supabase_image_artifact')
  }
  if (
    !metadata ||
    Object.keys(metadata).sort().join(',') !== 'architecture,registry,sha256,version' ||
    metadata.version !== 1 ||
    metadata.architecture !== 'amd64' ||
    !registries.includes(metadata.registry) ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '')
  )
    throw new Error('invalid_supabase_image_artifact')
  const current = await currentFiles(directory)
  if (metadata.registry !== current.registry || metadata.sha256 !== current.sha256)
    throw new Error('supabase_image_artifact_integrity_failed')
  await load(current.archive)
  return metadata.registry
}
async function main() {
  const mode = process.argv[2]
  if (
    process.argv.length !== 3 ||
    !['pack', 'load'].includes(mode) ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.arch !== 'x64' ||
    process.platform !== (mode === 'pack' ? 'linux' : 'darwin') ||
    !process.env.RUNNER_TEMP
  )
    throw new Error('owned_x64_image_artifact_runner_required')
  const directory = path.join(process.env.RUNNER_TEMP, 'supabase-image-cache')
  if (mode === 'pack') await packSupabaseArtifact(directory)
  else {
    if (!process.env.GITHUB_OUTPUT)
      throw new Error('supabase_image_artifact_output_required')
    const registry = await loadSupabaseArtifact(directory)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `registry=${registry}\n`)
  }
  console.log(`Verified amd64 Supabase image artifact ${mode} completed.`)
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await main()
