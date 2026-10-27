import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'
import {
  packSupabaseArtifact,
  loadSupabaseArtifact,
  loadIntoColima,
  qemuAccelerator,
  supabaseArtifactDirectory,
} from './share-card-supabase-artifact.mjs'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-image-artifact-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'images.tar.zst'), 'owned image archive fixture')
  fs.writeFileSync(path.join(directory, 'registry'), 'ghcr.io')
  return directory
}
test('integrity envelope pins amd64, exact compressed bytes and their registry before load', async (t) => {
  const directory = fixture(t)
  const metadata = await packSupabaseArtifact(directory)
  assert.equal(metadata.architecture, 'amd64')
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/)
  let observed
  assert.equal(
    await loadSupabaseArtifact(directory, async (file) => {
      observed = file
    }),
    'ghcr.io'
  )
  assert.equal(observed, path.join(directory, 'images.tar.zst'))
})
test('changed bytes, wrong architecture, registry mismatch and extra fields fail before Docker', async (t) => {
  for (const change of ['bytes', 'architecture', 'registry', 'extra']) {
    const directory = fixture(t)
    const metadata = await packSupabaseArtifact(directory)
    if (change === 'bytes')
      fs.appendFileSync(path.join(directory, 'images.tar.zst'), 'changed')
    if (change === 'architecture') metadata.architecture = 'arm64'
    if (change === 'registry') metadata.registry = 'public.ecr.aws'
    if (change === 'extra') metadata.token = 'private'
    fs.writeFileSync(
      path.join(directory, 'image-artifact.json'),
      JSON.stringify(metadata)
    )
    let called = false
    await assert.rejects(
      loadSupabaseArtifact(directory, async () => {
        called = true
      }),
      /(?:invalid_supabase_image_artifact|supabase_image_artifact_integrity_failed)/
    )
    assert.equal(called, false)
  }
})
test('empty or symlinked archives and unknown registry inputs never produce an envelope', async (t) => {
  for (const change of ['empty', 'symlink', 'registry']) {
    const directory = fixture(t)
    const file = path.join(directory, 'images.tar.zst')
    if (change === 'empty') fs.writeFileSync(file, '')
    if (change === 'symlink') {
      fs.renameSync(file, path.join(directory, 'elsewhere'))
      fs.symlinkSync(path.join(directory, 'elsewhere'), file)
    }
    if (change === 'registry')
      fs.writeFileSync(path.join(directory, 'registry'), 'private.invalid/token')
    await assert.rejects(
      packSupabaseArtifact(directory),
      /invalid_supabase_image_artifact/
    )
    assert.equal(fs.existsSync(path.join(directory, 'image-artifact.json')), false)
  }
})
test('Docker load failure remains a failed load', async (t) => {
  const directory = fixture(t)
  await packSupabaseArtifact(directory)
  await assert.rejects(
    loadSupabaseArtifact(directory, async () => {
      throw new Error('load failed')
    }),
    /load failed/
  )
})
function savedImages(t) {
  // A docker-save layout: manifest.json naming each image's config and layer files.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-colima-load-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const tree = path.join(directory, 'tree')
  fs.mkdirSync(path.join(tree, 'blobs'), { recursive: true })
  const files = {
    'blobs/big': 'x'.repeat(4000),
    'blobs/small': 'y',
    'blobs/cfg-a': '{}',
    'blobs/cfg-b': '{}',
  }
  for (const [name, body] of Object.entries(files))
    fs.writeFileSync(path.join(tree, name), body)
  fs.writeFileSync(
    path.join(tree, 'manifest.json'),
    JSON.stringify([
      {
        Config: 'blobs/cfg-a',
        RepoTags: ['ghcr.io/supabase/postgres:17.6.1.054'],
        Layers: ['blobs/big'],
      },
      {
        Config: 'blobs/cfg-b',
        RepoTags: ['ghcr.io/supabase/gotrue:v2.183.0'],
        Layers: ['blobs/small'],
      },
    ])
  )
  const archive = path.join(directory, 'images.tar.zst')
  const packed = spawnSync('/bin/bash', [
    '-c',
    'tar -c -f - -C "$1" . | zstd -q -o "$2"',
    'pack',
    tree,
    archive,
  ])
  assert.equal(packed.status, 0, String(packed.stderr))
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  // Fake colima accepts the disk probe and hands docker load its stdin; fake docker lists it.
  fs.writeFileSync(
    path.join(bin, 'colima'),
    '#!/bin/bash\n[ "$1" = ssh ] && [ "$2" = -- ] || exit 64\n[ "$3" = sh ] && exit 0\nshift 2\nexec "$@"\n',
    { mode: 0o755 }
  )
  fs.writeFileSync(
    path.join(bin, 'docker'),
    '#!/bin/bash\n[ "$1" = load ] || exit 64\n{ zstd -dc | tar -t -f - | sort | tr "\\n" " "; echo; } >> "$CC68_FAKE_LOADED"\n',
    { mode: 0o755 }
  )
  return { directory, archive, bin, loaded: path.join(directory, 'loaded') }
}
test('each image loads alone, smallest first, with its bytes and duration after a VM disk probe', (t) => {
  const f = savedImages(t)
  const lines = []
  const commands = []
  loadIntoColima(f.archive, {
    workRoot: f.directory,
    log: (line) => lines.push(line),
    run: (command, args, options) => {
      commands.push(
        command === '/bin/bash' ? args[2] : `${command} ${args[2] ?? ''}`.trim()
      )
      return spawnSync(command, args, {
        ...options,
        env: {
          ...process.env,
          PATH: `${f.bin}:${process.env.PATH}`,
          CC68_FAKE_LOADED: f.loaded,
        },
      })
    },
  })
  assert.deepEqual(commands, [
    'ps',
    'colima sh',
    'cc68-image-unpack',
    'cc68-image-load',
    'cc68-image-load',
  ])
  assert.deepEqual(
    fs
      .readFileSync(f.loaded, 'utf8')
      .trim()
      .split('\n')
      .map((row) => row.trim()),
    ['blobs/cfg-b blobs/small manifest.json', 'blobs/big blobs/cfg-a manifest.json']
  )
  const facts = JSON.parse(lines.at(-1).replace('Supabase image load: ', ''))
  assert.deepEqual(
    facts.stages.map(({ name, outcome }) => [name, outcome]),
    [
      ['disk', 'passed'],
      ['unpack', 'passed'],
      ['image-0', 'passed'],
      ['image-1', 'passed'],
    ]
  )
  assert.deepEqual(
    facts.images.map(({ ref, bytes, stage }) => [ref, bytes, stage]),
    [
      ['ghcr.io/supabase/gotrue:v2.183.0', 3, 'image-0'],
      ['ghcr.io/supabase/postgres:17.6.1.054', 4002, 'image-1'],
    ]
  )
  assert.equal(
    fs.readdirSync(f.directory).some((name) => name.startsWith('cc68-images-')),
    false
  )
})
test('an image that exhausts the budget is reported with its timeout and the work tree is removed', (t) => {
  const f = savedImages(t)
  let clock = 0
  const lines = []
  assert.throws(
    () =>
      loadIntoColima(f.archive, {
        workRoot: f.directory,
        log: (line) => lines.push(line),
        now: () => clock,
        run: (command, args, options) => {
          if (command === 'ps')
            return { status: 0, stdout: 'qemu-system-x86_64 -accel hvf' }
          if (args[2] === 'cc68-image-load' && args.includes('blobs/big')) {
            clock += 600000
            return { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }
          }
          return spawnSync(command, args, {
            ...options,
            env: {
              ...process.env,
              PATH: `${f.bin}:${process.env.PATH}`,
              CC68_FAKE_LOADED: f.loaded,
            },
          })
        },
      }),
    /supabase_image_artifact_image-1_timeout/
  )
  const facts = JSON.parse(lines.at(-1).replace('Supabase image load: ', ''))
  assert.equal(facts.accelerator, 'hvf')
  assert.deepEqual(facts.images.at(-1), {
    ref: 'ghcr.io/supabase/postgres:17.6.1.054',
    bytes: 4002,
    stage: 'image-1',
  })
  assert.deepEqual(facts.stages.at(-1), {
    name: 'image-1',
    outcome: 'timeout',
    durationMs: 600000,
  })
  assert.equal(
    fs.readdirSync(f.directory).some((name) => name.startsWith('cc68-images-')),
    false
  )
})
test('the reported accelerator is read from the QEMU command line', () => {
  assert.equal(
    qemuAccelerator('/usr/sbin/sshd\nqemu-system-x86_64 -accel hvf -cpu host'),
    'hvf'
  )
  assert.equal(qemuAccelerator('qemu-system-x86_64 -machine q35,accel=tcg'), 'tcg')
  assert.equal(qemuAccelerator('qemu-system-x86_64 -machine q35'), 'unreported')
  assert.equal(qemuAccelerator('limactl hostagent'), 'unavailable')
  assert.equal(qemuAccelerator(undefined), 'unavailable')
})
test('CLI refuses an unowned runner before reading artifacts or starting Docker', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/ci/share-card-supabase-artifact.mjs', 'load'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } }
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /owned_x64_image_artifact_runner_required/)
})
test('the Linux prewarm completes and publishes before native jobs; Mac pins and loads its exact registry', () => {
  const workflow = parse(
    fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
  )
  const warm = workflow.jobs['supabase-images']
  assert.equal(warm['runs-on'], 'ubuntu-latest')
  assert.equal(workflow.jobs['original-resource'].needs, 'supabase-images')
  const warmStart = warm.steps.findIndex(
    (row) => row.uses === './.github/actions/start-local-supabase'
  )
  const pack = warm.steps.findIndex((row) =>
    row.run?.includes('share-card-supabase-artifact.mjs pack')
  )
  const upload = warm.steps.findIndex((row) => row.uses === 'actions/upload-artifact@v4')
  assert.ok(warmStart >= 0 && warmStart < pack && pack < upload)
  assert.equal(warm.steps[upload].with.name, 'cc68-supabase-amd64')
  assert.equal(warm.steps[upload].with['if-no-files-found'], 'error')
  const steps = workflow.jobs['original-resource'].steps
  const download = steps.findIndex((row) => row.uses === 'actions/download-artifact@v4')
  const load = steps.findIndex((row) =>
    row.run?.includes('share-card-supabase-artifact.mjs load')
  )
  const start = steps.findIndex(
    (row) => row.uses === './.github/actions/start-local-supabase'
  )
  assert.ok(download >= 0 && download < load && load < start)
  assert.equal(steps[download].if, "runner.os == 'macOS'")
  assert.equal(steps[load].if, "runner.os == 'macOS'")
  assert.equal(steps[download].with.name, 'cc68-supabase-amd64')
  assert.ok(
    steps[start].with['image-registry'].includes(
      'steps.supabase-artifact.outputs.registry'
    )
  )
  // The Mac loads the prewarmed artifact; an Actions image cache there would add a
  // second full docker save through the forwarded socket.
  assert.equal(steps[start].with['image-cache'], "${{ runner.os != 'macOS' }}")
})
test('completed image archives can save even when another step has failed', () => {
  const action = parse(
    fs.readFileSync('.github/actions/start-local-supabase/action.yml', 'utf8')
  )
  const save = action.runs.steps.find((row) => row.uses === 'actions/cache/save@v4')
  assert.ok(save.if.includes('always()'))
  assert.ok(save.if.includes("steps.start.outputs.cache_written == 'true'"))
})

test('a Mac cache miss writes a reusable cache without changing the verified downloaded archive', async (t) => {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-image-cache-miss-'))
  t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }))
  const workflow = parse(
    fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
  )
  const download = workflow.jobs['original-resource'].steps.find(
    (row) => row.uses === 'actions/download-artifact@v4'
  )
  const directory = download.with.path.replace('${{ runner.temp }}', runnerTemp)
  assert.equal(directory, supabaseArtifactDirectory('load', runnerTemp))
  assert.equal(
    supabaseArtifactDirectory('pack', runnerTemp),
    path.join(runnerTemp, 'supabase-image-cache')
  )
  fs.mkdirSync(directory, { recursive: true })
  const archive = path.join(directory, 'images.tar.zst')
  const compressed = spawnSync('zstd', ['-q', '-c'], {
    input: 'prewarmed image fixture',
  })
  assert.equal(compressed.status, 0)
  fs.writeFileSync(archive, compressed.stdout)
  fs.writeFileSync(path.join(directory, 'registry'), 'ghcr.io')
  await packSupabaseArtifact(directory)
  await loadSupabaseArtifact(directory, (file) => {
    const loaded = spawnSync('zstd', ['-dc', file], { encoding: 'utf8' })
    assert.equal(loaded.status, 0)
    assert.equal(loaded.stdout, 'prewarmed image fixture')
  })
  const action = parse(
    fs.readFileSync('.github/actions/start-local-supabase/action.yml', 'utf8')
  )
  const start = action.runs.steps.find((row) => row.id === 'start')
  const writer = start.run.match(/^write_image_cache\(\) \{[\s\S]*?^\}/m)?.[0]
  assert.ok(writer, 'execute the actual composite-action cache writer')
  const cache = path.join(runnerTemp, 'supabase-image-cache')
  const output = path.join(runnerTemp, 'action-output')
  fs.writeFileSync(output, '')
  // Docker is injected; the action function and zstd collision behavior are real.
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -u -o pipefail
project_images() { printf '%s\\n' ghcr.io/supabase/postgres:fixture; }
docker() { test "$1" = save || return 1; printf '%s' 'fresh cache fixture'; }
${writer}
write_image_cache ghcr.io`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, CACHE_DIR: cache, GITHUB_OUTPUT: output },
    }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(fs.readFileSync(output, 'utf8'), /cache_written=true/, result.stderr)
  assert.deepEqual(fs.readFileSync(archive), compressed.stdout)
  const cached = spawnSync('zstd', ['-dc', path.join(cache, 'images.tar.zst')], {
    encoding: 'utf8',
  })
  assert.equal(cached.status, 0)
  assert.equal(cached.stdout, 'fresh cache fixture')
  assert.equal(fs.readFileSync(path.join(cache, 'registry'), 'utf8'), 'ghcr.io')
})
