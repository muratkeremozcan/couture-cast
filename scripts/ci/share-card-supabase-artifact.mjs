import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const registries = ['ghcr.io', 'public.ecr.aws', 'docker.io']
export function supabaseArtifactDirectory(mode, runnerTemp) {
  return path.join(
    runnerTemp,
    mode === 'pack' ? 'supabase-image-cache' : 'share-card-supabase-artifact'
  )
}
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
/** QEMU names its accelerator on the command line; Lima picks hvf or falls back to tcg. */
export function qemuAccelerator(processes) {
  if (typeof processes !== 'string') return 'unavailable'
  const qemu = processes.split('\n').find((line) => /qemu-system-x86_64\b/.test(line))
  if (!qemu) return 'unavailable'
  return qemu.match(/(?:-accel\s+|accel=)(hvf|tcg)\b/)?.[1] ?? 'unreported'
}
/**
 * The Colima docker socket is forwarded over SSH, so streaming the decompressed
 * images through it moves every uncompressed byte through that tunnel. Move the
 * compressed archive into the VM once and let its local dockerd decompress it.
 * Each stage reports its own duration so a timeout names the stage that used it.
 */
export function loadIntoColima(
  archive,
  {
    run = spawnSync,
    now = () => performance.now(),
    log = (line) => console.log(line),
    budgetMs = 600000,
    bytes = fs.statSync(archive).size,
    workRoot = process.env.RUNNER_TEMP ?? os.tmpdir(),
  } = {}
) {
  const started = now()
  const facts = { archiveBytes: bytes, accelerator: 'unavailable', stages: [] }
  const report = () => log(`Supabase image load: ${JSON.stringify(facts)}`)
  const ps = run('ps', ['-axo', 'command'], { encoding: 'utf8', timeout: 10000 })
  if (!ps.error && ps.status === 0) facts.accelerator = qemuAccelerator(ps.stdout)
  const stage = (name, command, args, options = {}) => {
    const remaining = Math.floor(budgetMs - (now() - started))
    if (remaining < 1000) {
      facts.stages.push({ name, outcome: 'not_started', durationMs: 0 })
      report()
      throw new Error(`supabase_image_artifact_${name}_timeout`)
    }
    const begin = now()
    const result = run(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      ...options,
      timeout: remaining,
      killSignal: 'SIGTERM',
    })
    const timedOut = result.error?.code === 'ETIMEDOUT'
    const outcome = timedOut
      ? 'timeout'
      : result.error || result.status !== 0
        ? 'failed'
        : 'passed'
    facts.stages.push({ name, outcome, durationMs: Math.round(now() - begin) })
    if (outcome !== 'passed') {
      report()
      throw new Error(
        timedOut
          ? `supabase_image_artifact_${name}_timeout`
          : 'supabase_image_artifact_load_failed'
      )
    }
    return result
  }
  // VM disk write throughput bounds how fast any docker load can extract layers.
  stage('disk', 'colima', [
    'ssh',
    '--',
    'sh',
    '-c',
    'dd if=/dev/zero of=/var/tmp/cc68-disk bs=1M count=512 conv=fsync 2>/dev/null; status=$?; rm -f /var/tmp/cc68-disk; exit $status',
  ])
  const work = fs.mkdtempSync(path.join(workRoot, 'cc68-images-'))
  try {
    stage('unpack', '/bin/bash', [
      '-c',
      'set -o pipefail; zstd -dc "$1" | tar -x -f - -C "$2"',
      'cc68-image-unpack',
      archive,
      work,
    ])
    const entries = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'))
    const images = entries
      .map((entry) => {
        const files = [entry.Config, ...entry.Layers]
        if (
          files.some(
            (file) =>
              typeof file !== 'string' || file.startsWith('/') || file.includes('..')
          )
        )
          throw new Error('invalid_supabase_image_artifact')
        const imageBytes = files.reduce(
          (sum, file) => sum + fs.statSync(path.join(work, file)).size,
          0
        )
        const ref = entry.RepoTags?.[0]
        return {
          entry,
          files,
          imageBytes,
          ref: typeof ref === 'string' && imageRef.test(ref) ? ref : 'unnamed',
        }
      })
      .sort((left, right) => left.imageBytes - right.imageBytes)
    facts.images = []
    // Smallest first: per-image durations show whether one image owns the budget.
    for (const [index, image] of images.entries()) {
      const single = path.join(work, `.single-${index}`)
      fs.mkdirSync(single)
      fs.writeFileSync(path.join(single, 'manifest.json'), JSON.stringify([image.entry]))
      // Each image names its stage; the stage holds its outcome and duration.
      facts.images.push({
        ref: image.ref,
        bytes: image.imageBytes,
        stage: `image-${index}`,
      })
      stage(`image-${index}`, '/bin/bash', [
        '-c',
        'set -o pipefail; single="$1"; base="$2"; shift 2; tar -c -f - -C "$single" manifest.json -C "$base" "$@" | zstd -1 -T0 -q | colima ssh -- docker load',
        'cc68-image-load',
        single,
        work,
        ...image.files,
      ])
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  report()
}
const imageRef = /^[a-z0-9.-]+(?::[0-9]+)?(?:\/[a-z0-9._-]+)+:[A-Za-z0-9._-]+$/
export async function loadSupabaseArtifact(directory, load = loadIntoColima) {
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
  const directory = supabaseArtifactDirectory(mode, process.env.RUNNER_TEMP)
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
