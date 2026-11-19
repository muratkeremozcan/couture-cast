const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

/**
 * The merger runs through the generated project's Gradle 8.14 wrapper, which cannot run on
 * JDK 25 (class file 69). GitHub's Linux images now default to JDK 25 and also ship JDK 21
 * and 17 under JAVA_HOME_<n>_<arch>, so the proof pins one of those when present; elsewhere
 * the caller's JAVA_HOME stands. The suite keeps running before the workflow's own Java
 * step, so a Java setup failure can never hide it.
 */
function gradleJavaHome(env) {
  for (const key of [
    'JAVA_HOME_21_X64',
    'JAVA_HOME_21_ARM64',
    'JAVA_HOME_17_X64',
    'JAVA_HOME_17_ARM64',
  ]) {
    const home = env[key]
    if (home && fs.existsSync(path.join(home, 'bin', 'java'))) return home
  }
  return env.JAVA_HOME
}
/**
 * The merger's Maven artifacts download fresh on every CI runner, where Maven Central answers
 * a busy runner pool with HTTP 429; scripts/lib/transient-resolution-retry.cjs retries such a
 * download failure after a wait and fails any other merge failure at once.
 */
const {
  isTransientResolutionFailure,
  runWithResolutionRetry,
} = require('../../../scripts/lib/transient-resolution-retry.cjs')
const { AndroidConfig } = require('@expo/config-plugins')
const {
  assertCommand,
  createExpoPrebuildWorkspace,
  repositoryRoot,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')

/** How long one merge may run before it is killed. */
const MERGE_TIMEOUT_MS = 120000
/**
 * Gradle's HTTP connect and read timeouts in the merger project. Gradle's own are 30 s, and Gradle
 * 8.14.3 sends a stalled GET three times, so one stalled download sat silent for 96 s before
 * Gradle printed "Read timed out" (local repro against a repository that never answers). With
 * the wrapper download and startup that outlasted MERGE_TIMEOUT_MS: PR 253 run 44169550859 and
 * main run 44160668534 killed the merge at 120 s with nothing after `> Task :processMainManifest`,
 * so the retry never saw an error. At 10 s a stall fails as "Read timed out" within the cap, and
 * the retry runs the merge again. A healthy download never waits 10 s for a byte.
 */
const GRADLE_HTTP_TIMEOUT_MS = 10000

/** The merger project's gradle.properties: Gradle's HTTP timeouts, bounded. */
function mergerGradleProperties() {
  return (
    `systemProp.org.gradle.internal.http.connectionTimeout=${GRADLE_HTTP_TIMEOUT_MS}\n` +
    `systemProp.org.gradle.internal.http.socketTimeout=${GRADLE_HTTP_TIMEOUT_MS}\n`
  )
}

function footprint(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const filename = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) return total
    return (
      total + (entry.isDirectory() ? footprint(filename) : fs.statSync(filename).size)
    )
  }, 0)
}

/**
 * Merge generated application policy with the two installed photo-library manifests and
 * expo-location's, which declares fine location the app must not ship (Use my location).
 */
async function generateAndroidPermissionProof(t) {
  const { assertStory68DiskSpace } = await import(
    '../../../scripts/lib/test-disk-space.mjs'
  )
  const availableBytes = assertStory68DiskSpace(os.tmpdir())
  const owned = createExpoPrebuildWorkspace({
    prefix: 'couture-story68-android-permissions-',
    entries: ['app.json', 'package.json', 'plugins', 'targets', 'assets', 'locales'],
  })
  t.after(() => {
    const bytes = footprint(owned.root)
    const root = owned.root
    owned.cleanup()
    t.diagnostic(
      JSON.stringify({
        owner: 'cc68-M4',
        root,
        availableBytes,
        ownedBytes: bytes,
        prunedOwnedRoot: !fs.existsSync(root),
        sharedBuildOutputsWritten: false,
      })
    )
  })
  assertCommand(
    runExpoPrebuild(owned.root, { platform: 'android' }),
    'Android permission prebuild failed'
  )
  const main = path.join(owned.root, 'android/app/src/main/AndroidManifest.xml')
  const proof = path.join(owned.root, 'permission-proof')
  fs.mkdirSync(proof)
  const libraries = []
  for (const name of ['expo-image-picker', 'expo-media-library', 'expo-location']) {
    const moduleRoot = path.dirname(
      require.resolve(`${name}/package.json`, { paths: [repositoryRoot] })
    )
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      path.join(moduleRoot, 'android/src/main/AndroidManifest.xml')
    )
    const gradle = fs.readFileSync(path.join(moduleRoot, 'android/build.gradle'), 'utf8')
    const namespace = gradle.match(/namespace\s+["']([^"']+)["']/)?.[1]
    assert.ok(namespace, `${name}: Android library namespace is required`)
    // AGP supplies this namespace while processing each library manifest.
    manifest.manifest.$.package = namespace
    const filename = path.join(proof, `${name}.xml`)
    await AndroidConfig.Manifest.writeAndroidManifestAsync(filename, manifest)
    libraries.push(filename)
  }
  const pluginVersions = fs.readFileSync(
    require.resolve('@react-native/gradle-plugin/gradle/libs.versions.toml', {
      paths: [repositoryRoot],
    }),
    'utf8'
  )
  const agp = pluginVersions.match(/^agp\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m)
  assert.ok(agp, 'Installed React Native Android Gradle plugin version is required')
  const mergerVersion = `${Number(agp[1]) + 23}.${agp[2]}.${agp[3]}`
  const output = path.join(proof, 'merged/AndroidManifest.xml')
  fs.mkdirSync(path.dirname(output))
  fs.writeFileSync(
    path.join(proof, 'settings.gradle'),
    "rootProject.name = 'cc68-permission-proof'\n"
  )
  fs.writeFileSync(path.join(proof, 'gradle.properties'), mergerGradleProperties())
  fs.writeFileSync(
    path.join(proof, 'build.gradle'),
    `
plugins { id 'java' }
repositories {
  google()
  // Google's mirror of Maven Central first, so the merger's Central artifacts rarely meet
  // Central's rate limit; Central itself stays as the fallback for anything not mirrored.
  maven { url 'https://maven-central.storage-download.googleapis.com/maven2/' }
  mavenCentral()
}
dependencies { runtimeOnly 'com.android.tools.build:manifest-merger:${mergerVersion}' }
tasks.register('processMainManifest', JavaExec) {
  classpath = configurations.runtimeClasspath
  mainClass = 'com.android.manifmerger.Merger'
  args '--main', System.getenv('CC68_PERMISSION_MAIN'),
    '--libs', System.getenv('CC68_PERMISSION_LIBRARIES'),
    '--property', 'PACKAGE=' + System.getenv('CC68_PERMISSION_APPLICATION_ID'),
    '--out', System.getenv('CC68_PERMISSION_MERGED'), '--remove-tools-declarations'
}
`
  )
  const javaHome = gradleJavaHome(process.env)
  const merged = runWithResolutionRetry(() =>
    spawnSync(
      path.join(owned.root, 'android/gradlew'),
      [
        '--project-dir',
        proof,
        '--project-cache-dir',
        path.join(proof, '.gradle'),
        '--no-daemon',
        '--max-workers=1',
        '--console=plain',
        'processMainManifest',
      ],
      {
        cwd: proof,
        encoding: 'utf8',
        timeout: MERGE_TIMEOUT_MS,
        env: {
          ...process.env,
          ...(javaHome ? { JAVA_HOME: javaHome } : {}),
          CC68_PERMISSION_MAIN: main,
          CC68_PERMISSION_APPLICATION_ID: JSON.parse(
            fs.readFileSync(path.join(owned.root, 'app.json'), 'utf8')
          ).expo.android.package,
          CC68_PERMISSION_LIBRARIES: libraries.join(path.delimiter),
          CC68_PERMISSION_MERGED: output,
        },
      }
    )
  )
  assertCommand(merged, 'Official Android manifest merger failed')
  const generated = await AndroidConfig.Manifest.readAndroidManifestAsync(main)
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(output)
  t.diagnostic(
    JSON.stringify({
      owner: 'cc68-M4',
      generatedMain: main,
      mergedManifest: output,
      mergerVersion,
      permissions: manifest.manifest['uses-permission'].map((item) => item.$),
    })
  )
  const gradleProperties = fs.readFileSync(path.join(proof, 'gradle.properties'), 'utf8')
  return { generated, gradleProperties, manifest }
}
module.exports = {
  GRADLE_HTTP_TIMEOUT_MS,
  MERGE_TIMEOUT_MS,
  generateAndroidPermissionProof,
  mergerGradleProperties,
  isTransientResolutionFailure,
  runWithResolutionRetry,
}
