// Learning path Step 24: watchOS glance companion app and complications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-24-watchos-glance-companion-app-and-complications
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const xcode = require('xcode')
const {
  assertCommand,
  createExpoPrebuildFixture,
  mobileRoot,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')

function findTarget(project, targetName) {
  return Object.entries(project.pbxNativeTargetSection()).find(
    ([uuid, target]) =>
      !uuid.endsWith('_comment') && String(target.name).replaceAll('"', '') === targetName
  )?.[1]
}

function buildPhaseFiles(project, target, sectionName) {
  const phases = project.hash.project.objects[sectionName] ?? {}
  const buildFiles = project.pbxBuildFileSection()
  return target.buildPhases.flatMap((reference) => {
    const phase = phases[reference.value]
    return (phase?.files ?? []).map((file) => buildFiles[file.value]?.fileRef_comment)
  })
}

test(
  'clean Expo prebuild generates watchOS app and complication targets',
  { timeout: 180_000 },
  (t) => {
    const fixtureRoot = createExpoPrebuildFixture(t, {
      prefix: 'couture-watchos-prebuild-',
    })

    const appJsonPath = path.join(fixtureRoot, 'app.json')
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    // Add existing entitlements to verify merging
    appJson.expo.ios.entitlements = {
      'com.apple.security.application-groups': ['group.existing.integration'],
    }
    fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

    assertCommand(runExpoPrebuild(fixtureRoot), 'Initial Expo prebuild failed')
    assertCommand(runExpoPrebuild(fixtureRoot), 'Repeated Expo prebuild failed')

    const projectPath = path.join(
      fixtureRoot,
      'ios/CoutureCast.xcodeproj/project.pbxproj'
    )
    const xcodeProject = fs.readFileSync(projectPath, 'utf8')
    const parsedProject = xcode.project(projectPath)
    parsedProject.parseSync()

    // Check watch targets and file linking
    assert.match(xcodeProject, /WatchApp\.swift in Sources/)
    assert.match(xcodeProject, /WatchContentView\.swift in Sources/)
    assert.match(xcodeProject, /WatchConnectivityManager\.swift in Sources/)
    assert.match(xcodeProject, /WatchWidgetData\.swift in Sources/)
    assert.match(xcodeProject, /WatchComplication\.swift in Sources/)
    assert.match(xcodeProject, /WatchComplicationData\.swift in Sources/)
    assert.match(xcodeProject, /SpaceGrotesk-WatchApp\.ttf in Resources/)
    assert.match(xcodeProject, /SpaceGrotesk-WatchWidget\.ttf in Resources/)
    assert.match(xcodeProject, /WatchConnectivity\.framework in Frameworks/)

    const mainTarget = findTarget(parsedProject, 'CoutureCast')
    const watchAppTarget = findTarget(parsedProject, 'WatchApp')
    const watchWidgetTarget = findTarget(parsedProject, 'WatchWidget')
    assert.ok(mainTarget)
    assert.ok(watchAppTarget)
    assert.ok(watchWidgetTarget)
    const targetDependencies =
      parsedProject.hash.project.objects.PBXTargetDependency ?? {}
    const watchDependencyNames = watchAppTarget.dependencies.map(
      (dependency) => targetDependencies[dependency.value]?.target_comment
    )
    assert.ok(
      watchDependencyNames.some((name) => String(name).includes('WatchWidget')),
      JSON.stringify(watchDependencyNames)
    )

    const mainEmbeds = buildPhaseFiles(
      parsedProject,
      mainTarget,
      'PBXCopyFilesBuildPhase'
    )
    assert.ok(mainEmbeds.includes('OutfitWidget.appex'))
    assert.ok(mainEmbeds.includes('WatchApp.app'))
    assert.ok(!mainEmbeds.includes('WatchWidget.appex'))

    const watchEmbeds = buildPhaseFiles(
      parsedProject,
      watchAppTarget,
      'PBXCopyFilesBuildPhase'
    )
    assert.deepEqual(
      watchEmbeds.filter((file) => file === 'WatchWidget.appex'),
      ['WatchWidget.appex']
    )

    const watchAppResources = buildPhaseFiles(
      parsedProject,
      watchAppTarget,
      'PBXResourcesBuildPhase'
    )
    const watchWidgetResources = buildPhaseFiles(
      parsedProject,
      watchWidgetTarget,
      'PBXResourcesBuildPhase'
    )
    assert.deepEqual(
      watchAppResources.filter((file) => file === 'SpaceGrotesk-WatchApp.ttf'),
      ['SpaceGrotesk-WatchApp.ttf']
    )
    assert.deepEqual(
      watchWidgetResources.filter((file) => file === 'SpaceGrotesk-WatchWidget.ttf'),
      ['SpaceGrotesk-WatchWidget.ttf']
    )

    // Check app groups merged defensively in main entitlements plist
    const mainEntitlements = fs.readFileSync(
      path.join(fixtureRoot, 'ios/CoutureCast/CoutureCast.entitlements'),
      'utf8'
    )
    assert.match(mainEntitlements, /group\.existing\.integration/)
    assert.match(mainEntitlements, /group\.com\.couturecast\.app/)
    assert.match(mainEntitlements, /group\.com\.couturecast\.app\.watch/)

    // Check target directories and files exist
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchApp.swift')))
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchContentView.swift'))
    )
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchConnectivityManager.swift'))
    )
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchWidgetData.swift')))
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/SpaceGrotesk-WatchApp.ttf'))
    )
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchApp-Info.plist')))
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'ios/WatchApp/WatchApp.entitlements')))
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchWidget/WatchComplication.swift'))
    )
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchWidget/WatchComplicationData.swift'))
    )
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'ios/WatchWidget/SpaceGrotesk-WatchWidget.ttf')
      )
    )
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchWidget/WatchWidget-Info.plist'))
    )
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/WatchWidget/WatchWidget.entitlements'))
    )

    if (process.platform === 'darwin') {
      assertCommand(
        spawnSync(
          'xcrun',
          [
            '--sdk',
            'watchos',
            'swiftc',
            '-typecheck',
            '-parse-as-library',
            '-target',
            'arm64-apple-watchos9.0',
            path.join(fixtureRoot, 'ios/WatchApp/WatchWidgetData.swift'),
            path.join(fixtureRoot, 'ios/WatchApp/WatchApp.swift'),
            path.join(fixtureRoot, 'ios/WatchApp/WatchConnectivityManager.swift'),
            path.join(fixtureRoot, 'ios/WatchApp/WatchContentView.swift'),
          ],
          { encoding: 'utf8', timeout: 50_000 }
        ),
        'Watch app Swift type-check failed'
      )
      assertCommand(
        spawnSync(
          'xcrun',
          [
            '--sdk',
            'watchos',
            'swiftc',
            '-typecheck',
            '-parse-as-library',
            '-application-extension',
            '-target',
            'arm64-apple-watchos9.0',
            path.join(fixtureRoot, 'ios/WatchWidget/WatchComplicationData.swift'),
            path.join(fixtureRoot, 'ios/WatchWidget/WatchComplication.swift'),
          ],
          { encoding: 'utf8', timeout: 50_000 }
        ),
        'Watch complication Swift type-check failed'
      )
      assertCommand(
        spawnSync(
          'xcodebuild',
          [
            '-project',
            path.join(fixtureRoot, 'ios/CoutureCast.xcodeproj'),
            '-target',
            'WatchApp',
            '-configuration',
            'Debug',
            '-sdk',
            'watchsimulator',
            '-destination',
            'generic/platform=watchOS Simulator',
            `SYMROOT=${path.join(fixtureRoot, 'build/products')}`,
            `OBJROOT=${path.join(fixtureRoot, 'build/intermediates')}`,
            'CODE_SIGNING_ALLOWED=NO',
            'build',
            '-quiet',
          ],
          { encoding: 'utf8', timeout: 120_000 }
        ),
        'Generated WatchApp target build failed'
      )
    }
  }
)

test('watch payload and transfer support pass native behavior tests', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Swift behavior tests require macOS')
    return
  }

  const testDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'couture-watchos-swift-tests-')
  )
  t.after(() => {
    assert.match(testDirectory, /couture-watchos-swift-tests-/)
    fs.rmSync(testDirectory, { recursive: true, force: true })
  })

  const watchDataBinary = path.join(testDirectory, 'watch-data-tests')
  assertCommand(
    spawnSync(
      'xcrun',
      [
        'swiftc',
        path.join(mobileRoot, 'targets/watchos/WatchWidgetData.swift'),
        path.join(mobileRoot, 'targets/watchos/WatchWidgetDataTests.swift'),
        '-o',
        watchDataBinary,
      ],
      { encoding: 'utf8', timeout: 50_000 }
    ),
    'Watch data behavior test compilation failed'
  )
  assertCommand(
    spawnSync(watchDataBinary, [], { encoding: 'utf8', timeout: 10_000 }),
    'Watch data behavior tests failed'
  )

  const syncSupportBinary = path.join(testDirectory, 'watch-sync-tests')
  assertCommand(
    spawnSync(
      'xcrun',
      [
        'swiftc',
        path.join(mobileRoot, 'targets/widgets/WatchSyncSupport.swift'),
        path.join(mobileRoot, 'targets/widgets/WatchSyncSupportTests.swift'),
        '-o',
        syncSupportBinary,
      ],
      { encoding: 'utf8', timeout: 50_000 }
    ),
    'Watch transfer behavior test compilation failed'
  )
  assertCommand(
    spawnSync(syncSupportBinary, [], {
      encoding: 'utf8',
      timeout: 10_000,
    }),
    'Watch transfer behavior tests failed'
  )
})
