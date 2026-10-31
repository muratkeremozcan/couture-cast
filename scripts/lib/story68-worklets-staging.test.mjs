// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  prepareWorkletsStaging,
  verifyWorkletsStaging,
} from './story68-worklets-staging.mjs'
import { gradleRunLog, requireGradleWrapper } from './story68-gradle-precondition.mjs'

const wrapper = path.resolve('apps/mobile/android/gradlew')
const fixtures = new Set()

function fixture(configuration, abi, extra = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-worklets-unit-'))
  fixtures.add(directory)
  const projectRoot = path.join(directory, 'apps/mobile/android')
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.writeFileSync(
    path.join(projectRoot, 'settings.gradle'),
    `rootProject.name = 'worklets-staging-fixture'
include ':react-native-worklets', ':react-native-reanimated'
includeBuild 'unrelated-plugin'
`
  )
  const unrelated = path.join(projectRoot, 'unrelated-plugin')
  fs.mkdirSync(unrelated)
  fs.writeFileSync(
    path.join(unrelated, 'settings.gradle'),
    "rootProject.name = 'unrelated-plugin'\n"
  )
  fs.writeFileSync(
    path.join(unrelated, 'build.gradle'),
    "tasks.register('pluginCheck') {}\n"
  )
  const native = configuration === 'Release' ? 'RelWithDebInfo' : 'Debug'
  for (const name of ['react-native-worklets', 'react-native-reanimated'])
    fs.mkdirSync(path.join(projectRoot, name))
  fs.writeFileSync(
    path.join(projectRoot, 'react-native-worklets/build.gradle'),
    `
class FixtureNativeTask extends DefaultTask {
  @Internal final DirectoryProperty soFolder = project.objects.directoryProperty()
  @TaskAction void compileBinary() {
    def binary = soFolder.file('libworklets.so').get().asFile
    binary.parentFile.mkdirs()
    binary.bytes = 'compiled-${configuration}-${abi}'.bytes
  }
}

tasks.register('buildCMake${native}[${abi}][worklets]', FixtureNativeTask) {
  soFolder.set(layout.buildDirectory.dir('intermediates/cxx/${native}/current-hash/obj/${abi}'))
}

tasks.register('externalNativeBuild${configuration}') {
  dependsOn 'buildCMake${native}[${abi}][worklets]'
}

${extra}

`
  )
  fs.writeFileSync(
    path.join(projectRoot, 'react-native-reanimated/build.gradle'),
    `
tasks.register('buildCMake${native}[${abi}][reanimated]') {
  doLast {
    def legacy = project(':react-native-worklets').file('build/intermediates/cmake/${configuration.toLowerCase()}/obj/${abi}/libworklets.so')
    if (!legacy.isFile()) throw new GradleException('legacy_worklets_import_missing')
    if (legacy.text != 'compiled-${configuration}-${abi}') throw new GradleException('legacy_worklets_import_stale')
    rootProject.file('reanimated-imported.txt').text = legacy.text
  }
}

`
  )
  fs.writeFileSync(
    path.join(projectRoot, 'build.gradle'),
    `tasks.register('assemble${configuration}') {
  dependsOn ':react-native-reanimated:buildCMake${native}[${abi}][reanimated]'
  dependsOn gradle.includedBuild('unrelated-plugin').task(':pluginCheck')
}

`
  )
  return {
    directory,
    projectRoot,
    configuration,
    architectures: abi,
    evidenceDirectory: directory,
  }
}

// Each offline --no-daemon Gradle run gets its own deadline. A test's budget covers
// all of its sequential runs plus fixture setup and assertions.
const GRADLE_RUN_TIMEOUT_MS = 60_000
const budget = (runs) => ({ timeout: runs * GRADLE_RUN_TIMEOUT_MS + 30_000 })

function run(input, init = true) {
  requireGradleWrapper(wrapper)
  const plan = init ? prepareWorkletsStaging(input) : undefined
  const result = spawnSync(
    wrapper,
    [
      '-p',
      input.projectRoot,
      `assemble${input.configuration}`,
      '--offline',
      '--no-daemon',
      '--max-workers=1',
      '--console=plain',
      ...(plan?.args ?? []),
    ],
    { encoding: 'utf8', timeout: GRADLE_RUN_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }
  )
  return { plan, result, log: gradleRunLog(result) }
}

describe('worklets staging', () => {
  test.after(() => {
    for (const directory of fixtures)
      fs.rmSync(directory, { recursive: true, force: true })
  })

  for (const configuration of ['Debug', 'Release']) {
    for (const abi of ['arm64-v8a', 'x86_64']) {
      test(
        `stages exact ${configuration}/${abi} task output before the real native consumer`,
        budget(3),
        () => {
          const input = fixture(configuration, abi)
          const baseline = run(input, false)
          assert.notEqual(baseline.result.status, 0)
          assert.match(baseline.log, /legacy_worklets_import_missing/)
          const w = path.join(
            input.projectRoot,
            'react-native-worklets/build/intermediates'
          )
          // A stale alternate hash and wrong variant must never become candidates.
          for (const variant of ['Debug', 'RelWithDebInfo']) {
            const stale = path.join(w, `cxx/${variant}/stale-hash/obj/${abi}`)
            fs.mkdirSync(stale, { recursive: true })
            fs.writeFileSync(path.join(stale, 'libworklets.so'), 'stale')
          }
          const { plan, result, log } = run(input)
          assert.equal(result.status, 0, log)
          const proofs = verifyWorkletsStaging(plan)
          assert.equal(proofs.length, 1)
          assert.match(proofs[0].compiled, /current-hash/)
          assert.equal(
            proofs[0].compiledSha256,
            createHash('sha256').update(`compiled-${configuration}-${abi}`).digest('hex')
          )
          assert.equal(proofs[0].compiledSha256, proofs[0].legacyImportedSha256)
          assert.equal(
            fs.readFileSync(
              path.join(input.projectRoot, 'reanimated-imported.txt'),
              'utf8'
            ),
            `compiled-${configuration}-${abi}`
          )
          // A second build must verify again, replacing a corrupted legacy import.
          fs.writeFileSync(proofs[0].legacyImported, 'corrupted')
          assert.throws(
            () => verifyWorkletsStaging(plan),
            /worklets_staging_hash_mismatch/
          )
          const repeated = run(input)
          assert.equal(repeated.result.status, 0, repeated.log)
          verifyWorkletsStaging(repeated.plan)
        }
      )
    }
  }

  for (const configuration of ['Debug', 'Release']) {
    for (const abi of ['arm64-v8a', 'x86_64']) {
      test(
        `preserves AGP hardlink source bytes for ${configuration}/${abi}`,
        budget(1),
        () => {
          const native = configuration === 'Release' ? 'RelWithDebInfo' : 'Debug'
          const input = fixture(
            configuration,
            abi,
            `
        tasks.named('externalNativeBuild${configuration}') {
          doLast {
            def source = tasks.named('buildCMake${native}[${abi}][worklets]').get().soFolder.file('libworklets.so').get().asFile
            def legacy = file('build/intermediates/cmake/${configuration.toLowerCase()}/obj/${abi}/libworklets.so')
            legacy.parentFile.mkdirs()
            java.nio.file.Files.deleteIfExists(legacy.toPath())
            java.nio.file.Files.createLink(legacy.toPath(), source.toPath())
            new File(legacy.parentFile, 'other-native-product.so').text = 'untouched'
          }
        }
      `
          )
          const { plan, result, log } = run(input)
          const compiledPath = path.join(
            input.projectRoot,
            `react-native-worklets/build/intermediates/cxx/${native}/current-hash/obj/${abi}/libworklets.so`
          )
          const legacyPath = path.join(
            input.projectRoot,
            `react-native-worklets/build/intermediates/cmake/${configuration.toLowerCase()}/obj/${abi}/libworklets.so`
          )
          const shape = (binary) => {
            const value = fs.statSync(binary)
            return { inode: value.ino, links: value.nlink, size: value.size }
          }
          assert.equal(
            result.status,
            0,
            log +
              '\n' +
              JSON.stringify({ compiled: shape(compiledPath), legacy: shape(legacyPath) })
          )
          const [proof] = verifyWorkletsStaging(plan)
          assert.equal(proof.stagingMode, 'same_file_verified')
          const expected = `compiled-${configuration}-${abi}`
          assert.equal(fs.readFileSync(proof.compiled, 'utf8'), expected)
          assert.equal(fs.readFileSync(proof.legacyImported, 'utf8'), expected)
          const source = fs.statSync(proof.compiled)
          const target = fs.statSync(proof.legacyImported)
          assert.equal(source.ino, target.ino)
          assert.equal(source.dev, target.dev)
          assert.equal(source.nlink, 2)
          assert.equal(source.size, Buffer.byteLength(expected))
          assert.equal(
            fs.readFileSync(
              path.join(path.dirname(proof.legacyImported), 'other-native-product.so'),
              'utf8'
            ),
            'untouched'
          )
        }
      )
    }
  }

  test(
    'atomically replaces only an independent stale import and preserves its other hard link',
    budget(1),
    () => {
      const input = fixture('Release', 'arm64-v8a')
      const directory = path.join(
        input.projectRoot,
        'react-native-worklets/build/intermediates/cmake/release/obj/arm64-v8a'
      )
      fs.mkdirSync(directory, { recursive: true })
      const legacy = path.join(directory, 'libworklets.so')
      const other = path.join(directory, 'other-native-product.so')
      fs.writeFileSync(other, 'independent-stale-binary')
      fs.linkSync(other, legacy)
      const oldInode = fs.statSync(other).ino
      const { plan, result, log } = run(input)
      assert.equal(result.status, 0, log)
      const [proof] = verifyWorkletsStaging(plan)
      assert.equal(proof.stagingMode, 'atomic_replacement')
      assert.equal(fs.readFileSync(other, 'utf8'), 'independent-stale-binary')
      assert.equal(fs.statSync(other).ino, oldInode)
      assert.notEqual(fs.statSync(legacy).ino, oldInode)
      assert.deepEqual(fs.readdirSync(directory).sort(), [
        'libworklets.so',
        'other-native-product.so',
      ])
      assert.equal(fs.readFileSync(proof.compiled, 'utf8'), 'compiled-Release-arm64-v8a')
    }
  )

  test(
    'rejects ambiguous native task identities without selecting a stale hash',
    budget(1),
    () => {
      const input = fixture(
        'Release',
        'arm64-v8a',
        `tasks.register('buildCMakeRelWithDebInfo[arm64-v8a]', FixtureNativeTask) {
    soFolder.set(layout.buildDirectory.dir('intermediates/cxx/RelWithDebInfo/other-hash/obj/arm64-v8a'))
  }`
      )
      const { result, log } = run(input)
      assert.notEqual(result.status, 0)
      assert.match(log, /exact_worklets_native_task_required/)
    }
  )

  test(
    'rejects an output from the wrong variant before Reanimated reads it',
    budget(1),
    () => {
      const input = fixture(
        'Release',
        'x86_64',
        `tasks.named('buildCMakeRelWithDebInfo[x86_64][worklets]') {
    soFolder.set(layout.buildDirectory.dir('intermediates/cxx/Debug/current-hash/obj/x86_64'))
  }`
      )
      const { result, log } = run(input)
      assert.notEqual(result.status, 0)
      assert.match(log, /exact_worklets_native_output_required/)
      assert.equal(
        fs.existsSync(path.join(input.projectRoot, 'reanimated-imported.txt')),
        false
      )
    }
  )

  test('fails if the selected native dependency produces no binary', budget(1), () => {
    const input = fixture(
      'Debug',
      'arm64-v8a',
      'tasks.named("buildCMakeDebug[arm64-v8a][worklets]") { actions.clear() }'
    )
    const legacy = path.join(
      input.projectRoot,
      'react-native-worklets/build/intermediates/cmake/debug/obj/arm64-v8a'
    )
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'libworklets.so'), 'compiled-Debug-arm64-v8a')
    const { result, log } = run(input)
    assert.notEqual(result.status, 0)
    assert.match(log, /compiled_worklets_binary_required/)
  })

  test('rejects unsupported configurations and architecture input before writing an init script', () => {
    const input = fixture('Debug', 'arm64-v8a')
    for (const configuration of ['debug', 'Profile', '', undefined])
      assert.throws(
        () => prepareWorkletsStaging({ ...input, configuration }),
        /worklets_build_selection_required/
      )
    for (const architectures of [
      'armeabi-v7a',
      'arm64-v8a,x86',
      '',
      '../x86_64',
      'x86_64,x86_64',
    ])
      assert.throws(
        () => prepareWorkletsStaging({ ...input, architectures }),
        /worklets_build_selection_required/
      )
  })
})
