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
const { AndroidConfig } = require('@expo/config-plugins')
const {
  assertCommand,
  createExpoPrebuildWorkspace,
  repositoryRoot,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')

function footprint(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const filename = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) return total
    return (
      total + (entry.isDirectory() ? footprint(filename) : fs.statSync(filename).size)
    )
  }, 0)
}

/** Merge generated application policy with the two installed photo-library manifests. */
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
  for (const name of ['expo-image-picker', 'expo-media-library']) {
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
  fs.writeFileSync(
    path.join(proof, 'build.gradle'),
    `
plugins { id 'java' }
repositories { google(); mavenCentral() }
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
  const merged = spawnSync(
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
      timeout: 120000,
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
  return { generated, manifest }
}
module.exports = { generateAndroidPermissionProof }
