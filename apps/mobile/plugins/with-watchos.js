// Story 3.4 Task 4 step 1 owner: generate watchOS targets and link font resources in Expo config plugin in apps/mobile/plugins/with-watchos.js
const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins')
const plist = require('@expo/plist').default
const fs = require('fs')
const path = require('path')

const watchAppGroup = 'group.com.couturecast.app.watch'
const iosAppGroup = 'group.com.couturecast.app'

const watchAppName = 'WatchApp'
const watchAppBundleId = 'com.couturecast.app.watchapp'

const watchWidgetName = 'WatchWidget'
const watchWidgetBundleId = 'com.couturecast.app.watchapp.watchwidget'

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

function copyFile(source, destination) {
  ensureDirectory(path.dirname(destination))
  fs.copyFileSync(source, destination)
}

function resolveSpaceGroteskFont(projectRoot) {
  return require.resolve(
    '@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf',
    { paths: [projectRoot] }
  )
}

function withEasWatchTargets(config) {
  const eas = config.extra?.eas ?? {}
  const build = eas.build ?? {}
  const experimental = build.experimental ?? {}
  const ios = experimental.ios ?? {}
  const appExtensions = Array.isArray(ios.appExtensions) ? [...ios.appExtensions] : []

  // Register watch companion app and complication targets
  const watchAppExtension = {
    targetName: watchAppName,
    bundleIdentifier: watchAppBundleId,
    entitlements: {
      'com.apple.security.application-groups': [watchAppGroup],
    },
  }

  const watchWidgetExtension = {
    targetName: watchWidgetName,
    bundleIdentifier: watchWidgetBundleId,
    entitlements: {
      'com.apple.security.application-groups': [watchAppGroup],
    },
  }

  // Deduplicate and push targets
  const addOrReplaceTarget = (target) => {
    const idx = appExtensions.findIndex((t) => t.targetName === target.targetName)
    if (idx >= 0) {
      appExtensions[idx] = target
    } else {
      appExtensions.push(target)
    }
  }

  addOrReplaceTarget(watchAppExtension)
  addOrReplaceTarget(watchWidgetExtension)

  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: {
            ...ios,
            appExtensions,
          },
        },
      },
    },
  }

  return config
}

// Add the Watch App Group to the main iOS app entitlements plist defensively
function withIosWatchAppGroup(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    const currentGroups = modConfig.modResults['com.apple.security.application-groups']
    const groups = Array.isArray(currentGroups) ? currentGroups : []
    // Ensure we keep the existing group.com.couturecast.app and add the watch group
    modConfig.modResults['com.apple.security.application-groups'] = [
      ...new Set([...groups, iosAppGroup, watchAppGroup]),
    ]
    return modConfig
  })
}

function findTarget(project, targetName) {
  const targets = project.pbxNativeTargetSection()
  for (const [uuid, target] of Object.entries(targets)) {
    if (uuid.endsWith('_comment')) {
      continue
    }
    const name = String(target.name ?? '').replaceAll('"', '')
    if (name === targetName) {
      return { uuid, pbxNativeTarget: target }
    }
  }
  return undefined
}

function addGroupToMainGroup(project, mainGroupKey, group) {
  const mainGroup = project.getPBXGroupByKey(mainGroupKey)
  const alreadyPresent = mainGroup.children.some((child) => child.value === group.uuid)
  if (!alreadyPresent) {
    mainGroup.children.push({ value: group.uuid, comment: group.name })
  }
}

function targetBuildConfigurations(project, target) {
  const configurationList =
    project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList]
  const configurations = project.pbxXCBuildConfigurationSection()
  return configurationList.buildConfigurations.map(
    (configurationReference) => configurations[configurationReference.value]
  )
}

function configureTargetBuildSettings(
  project,
  target,
  name,
  bundleId,
  entitlementsPath,
  deploymentTarget,
  sdk
) {
  for (const configuration of targetBuildConfigurations(project, target)) {
    Object.assign(configuration.buildSettings, {
      CODE_SIGN_ENTITLEMENTS: `"${entitlementsPath}"`,
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: '1',
      GENERATE_INFOPLIST_FILE: 'NO',
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
      PRODUCT_NAME: `"${name}"`,
      SKIP_INSTALL: 'YES',
      SWIFT_VERSION: '5.0',
      ...(name === watchWidgetName ? { APPLICATION_EXTENSION_API_ONLY: 'YES' } : {}),
      ...(sdk === 'watchos'
        ? {
            WATCHOS_DEPLOYMENT_TARGET: deploymentTarget,
            SDKROOT: 'watchos',
            TARGETED_DEVICE_FAMILY: '4',
          }
        : {
            IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
            TARGETED_DEVICE_FAMILY: '"1,2"',
          }),
    })
  }
}

function writeWatchExtensionFiles(projectRoot, iosDirectory) {
  const sourceDirectory = path.join(projectRoot, 'targets/watchos')
  const watchAppDir = path.join(iosDirectory, watchAppName)
  const watchWidgetDir = path.join(iosDirectory, watchWidgetName)

  ensureDirectory(watchAppDir)
  ensureDirectory(watchWidgetDir)

  // Copy watch companion app source files
  copyFile(
    path.join(sourceDirectory, 'WatchApp.swift'),
    path.join(watchAppDir, 'WatchApp.swift')
  )
  copyFile(
    path.join(sourceDirectory, 'WatchContentView.swift'),
    path.join(watchAppDir, 'WatchContentView.swift')
  )
  copyFile(
    path.join(sourceDirectory, 'WatchConnectivityManager.swift'),
    path.join(watchAppDir, 'WatchConnectivityManager.swift')
  )
  copyFile(
    path.join(sourceDirectory, 'WatchWidgetData.swift'),
    path.join(watchAppDir, 'WatchWidgetData.swift')
  )

  // Copy complication widget source files
  copyFile(
    path.join(sourceDirectory, 'WatchComplication.swift'),
    path.join(watchWidgetDir, 'WatchComplication.swift')
  )
  copyFile(
    path.join(sourceDirectory, 'WatchWidgetData.swift'),
    path.join(watchWidgetDir, 'WatchComplicationData.swift')
  )

  // Copy Space Grotesk font into watch targets
  copyFile(
    resolveSpaceGroteskFont(projectRoot),
    path.join(watchAppDir, 'SpaceGrotesk-WatchApp.ttf')
  )
  copyFile(
    resolveSpaceGroteskFont(projectRoot),
    path.join(watchWidgetDir, 'SpaceGrotesk-WatchWidget.ttf')
  )

  // Plists
  fs.writeFileSync(
    path.join(watchAppDir, `${watchAppName}-Info.plist`),
    plist.build({
      CFBundleDisplayName: 'CoutureCast',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'APPL',
      CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      CFBundleURLTypes: [
        {
          CFBundleURLName: 'com.couturecast.app.watchapp',
          CFBundleURLSchemes: ['couturecast-watch'],
        },
      ],
      WKCompanionAppBundleIdentifier: 'com.couturecast.app',
      WKApplication: true,
      UIAppFonts: ['SpaceGrotesk-WatchApp.ttf'],
    })
  )

  fs.writeFileSync(
    path.join(watchWidgetDir, `${watchWidgetName}-Info.plist`),
    plist.build({
      CFBundleDisplayName: 'CoutureCast Complications',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      NSExtension: {
        NSExtensionPointIdentifier: 'com.apple.widgetkit-extension',
      },
      UIAppFonts: ['SpaceGrotesk-WatchWidget.ttf'],
    })
  )

  // Entitlements
  fs.writeFileSync(
    path.join(watchAppDir, `${watchAppName}.entitlements`),
    plist.build({
      'com.apple.security.application-groups': [watchAppGroup],
    })
  )

  fs.writeFileSync(
    path.join(watchWidgetDir, `${watchWidgetName}.entitlements`),
    plist.build({
      'com.apple.security.application-groups': [watchAppGroup],
    })
  )
}

function findProductBuildFile(project, productName) {
  const buildFiles = project.hash.project.objects.PBXBuildFile ?? {}
  for (const [uuid, buildFile] of Object.entries(buildFiles)) {
    if (!uuid.endsWith('_comment') && buildFile.fileRef_comment === productName) {
      return {
        value: uuid,
        comment: `${productName} in Copy Files`,
      }
    }
  }
  return undefined
}

function removeEmptyCopyPhase(project, phaseUuid) {
  const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
  const phase = copyPhases[phaseUuid]
  if (!phase || phase.files?.length) {
    return
  }

  const targets = project.pbxNativeTargetSection()
  for (const [uuid, target] of Object.entries(targets)) {
    if (!uuid.endsWith('_comment') && target.buildPhases) {
      target.buildPhases = target.buildPhases.filter(
        (reference) => reference.value !== phaseUuid
      )
    }
  }
  delete copyPhases[phaseUuid]
  delete copyPhases[`${phaseUuid}_comment`]
}

function ensureWatchWidgetEmbedPhase(project, watchAppTarget) {
  const productBuildFile = findProductBuildFile(project, `${watchWidgetName}.appex`)
  if (!productBuildFile) {
    throw new Error('Unable to locate the WatchWidget product build file')
  }

  const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
  const targetPhases = watchAppTarget.pbxNativeTarget.buildPhases
  let destinationReference = targetPhases.find((reference) => {
    const phase = copyPhases[reference.value]
    return phase?.name === '"Embed App Extensions"'
  })
  if (!destinationReference) {
    const destination = project.addBuildPhase(
      [],
      'PBXCopyFilesBuildPhase',
      'Embed App Extensions',
      watchAppTarget.uuid,
      'watch2_extension'
    )
    destinationReference = {
      value: destination.uuid,
      comment: 'Embed App Extensions',
    }
  }

  const destinationPhase = copyPhases[destinationReference.value]
  const emptiedPhaseUuids = []
  for (const [uuid, phase] of Object.entries(copyPhases)) {
    if (uuid.endsWith('_comment') || !Array.isArray(phase.files)) {
      continue
    }
    phase.files = phase.files.filter(
      (file) =>
        uuid === destinationReference.value || file.value !== productBuildFile.value
    )
    if (uuid !== destinationReference.value && phase.files.length === 0) {
      emptiedPhaseUuids.push(uuid)
    }
  }

  if (!destinationPhase.files.some((file) => file.value === productBuildFile.value)) {
    destinationPhase.files.push(productBuildFile)
  }
  for (const uuid of emptiedPhaseUuids) {
    removeEmptyCopyPhase(project, uuid)
  }
}

function ensureWatchAppEmbedPhase(project, mainTarget) {
  const productBuildFile = findProductBuildFile(project, `${watchAppName}.app`)
  if (!productBuildFile) {
    throw new Error('Unable to locate the WatchApp product build file')
  }

  const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
  let destinationReference = mainTarget.pbxNativeTarget.buildPhases.find(
    (reference) => copyPhases[reference.value]?.name === '"Embed Watch Content"'
  )
  if (!destinationReference) {
    const destination = project.addBuildPhase(
      [],
      'PBXCopyFilesBuildPhase',
      'Embed Watch Content',
      mainTarget.uuid,
      'watch2_app',
      '"$(CONTENTS_FOLDER_PATH)/Watch"'
    )
    destinationReference = {
      value: destination.uuid,
      comment: 'Embed Watch Content',
    }
  }

  const destinationPhase = copyPhases[destinationReference.value]
  for (const [uuid, phase] of Object.entries(copyPhases)) {
    if (
      uuid !== destinationReference.value &&
      !uuid.endsWith('_comment') &&
      Array.isArray(phase.files)
    ) {
      phase.files = phase.files.filter((file) => file.value !== productBuildFile.value)
    }
  }
  if (!destinationPhase.files.some((file) => file.value === productBuildFile.value)) {
    destinationPhase.files.push(productBuildFile)
  }
}

function addResourceFileToTarget(project, fileName, targetUuid, groupKey) {
  if (project.hasFile(fileName)) {
    return
  }
  const resourceFile = project.addFile(fileName, groupKey)
  resourceFile.target = targetUuid
  resourceFile.uuid = project.generateUuid()
  resourceFile.group = 'Resources'
  project.addToPbxBuildFileSection(resourceFile)
  project.addToPbxResourcesBuildPhase(resourceFile)
}

function ensureTargetDependency(project, targetUuid, dependencyUuid) {
  const targets = project.pbxNativeTargetSection()
  project.hash.project.objects.PBXTargetDependency ??= {}
  project.hash.project.objects.PBXContainerItemProxy ??= {}
  const targetDependencies = project.hash.project.objects.PBXTargetDependency
  const alreadyPresent = targets[targetUuid].dependencies.some(
    (reference) => targetDependencies[reference.value]?.target === dependencyUuid
  )
  if (!alreadyPresent) {
    project.addTargetDependency(targetUuid, [dependencyUuid])
  }
}

function addWatchTargetsToXcode(project, mainGroupKey) {
  const mainTargetUuid = project.getFirstTarget().uuid
  const mainTarget = {
    uuid: mainTargetUuid,
    pbxNativeTarget: project.pbxNativeTargetSection()[mainTargetUuid],
  }

  // Watch App Target
  let watchAppTarget = findTarget(project, watchAppName)
  if (!watchAppTarget) {
    watchAppTarget = project.addTarget(
      watchAppName,
      'application',
      watchAppName,
      watchAppBundleId
    )
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', watchAppTarget.uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', watchAppTarget.uuid)
    project.addBuildPhase(
      [],
      'PBXFrameworksBuildPhase',
      'Frameworks',
      watchAppTarget.uuid
    )
  }

  // Watch Widget (Complications) Target
  let watchWidgetTarget = findTarget(project, watchWidgetName)
  if (!watchWidgetTarget) {
    watchWidgetTarget = project.addTarget(
      watchWidgetName,
      'app_extension',
      watchWidgetName,
      watchWidgetBundleId
    )
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', watchWidgetTarget.uuid)
    project.addBuildPhase(
      [],
      'PBXResourcesBuildPhase',
      'Resources',
      watchWidgetTarget.uuid
    )
    project.addBuildPhase(
      [],
      'PBXFrameworksBuildPhase',
      'Frameworks',
      watchWidgetTarget.uuid
    )
  }

  ensureWatchAppEmbedPhase(project, mainTarget)
  ensureWatchWidgetEmbedPhase(project, watchAppTarget)
  ensureTargetDependency(project, mainTarget.uuid, watchAppTarget.uuid)
  ensureTargetDependency(project, watchAppTarget.uuid, watchWidgetTarget.uuid)

  // Ensure groups exist and reference files
  let watchAppGroupKey = project.findPBXGroupKey({ name: watchAppName })
  if (!watchAppGroupKey) {
    const group = project.addPbxGroup([], watchAppName, watchAppName)
    watchAppGroupKey = group.uuid
    addGroupToMainGroup(project, mainGroupKey, group)
  }

  let watchWidgetGroupKey = project.findPBXGroupKey({ name: watchWidgetName })
  if (!watchWidgetGroupKey) {
    const group = project.addPbxGroup([], watchWidgetName, watchWidgetName)
    watchWidgetGroupKey = group.uuid
    addGroupToMainGroup(project, mainGroupKey, group)
  }

  // Link watch app files
  const watchAppFiles = [
    'WatchApp.swift',
    'WatchContentView.swift',
    'WatchConnectivityManager.swift',
    'WatchWidgetData.swift',
  ]
  watchAppFiles.forEach((file) => {
    if (!project.hasFile(file)) {
      project.addSourceFile(file, { target: watchAppTarget.uuid }, watchAppGroupKey)
    }
  })

  addResourceFileToTarget(
    project,
    'SpaceGrotesk-WatchApp.ttf',
    watchAppTarget.uuid,
    watchAppGroupKey
  )

  // Link watch widget files
  for (const file of ['WatchComplication.swift', 'WatchComplicationData.swift']) {
    if (!project.hasFile(file)) {
      project.addSourceFile(file, { target: watchWidgetTarget.uuid }, watchWidgetGroupKey)
    }
  }
  addResourceFileToTarget(
    project,
    'SpaceGrotesk-WatchWidget.ttf',
    watchWidgetTarget.uuid,
    watchWidgetGroupKey
  )

  // Add WatchConnectivity.framework to the main iOS app target framework phase
  project.addFramework('WatchConnectivity.framework', { target: mainTargetUuid })

  // References plists and entitlements
  addFileReference(project, `${watchAppName}-Info.plist`, watchAppGroupKey)
  addFileReference(project, `${watchAppName}.entitlements`, watchAppGroupKey)
  addFileReference(project, `${watchWidgetName}-Info.plist`, watchWidgetGroupKey)
  addFileReference(project, `${watchWidgetName}.entitlements`, watchWidgetGroupKey)

  // Configure build settings
  configureTargetBuildSettings(
    project,
    watchAppTarget,
    watchAppName,
    watchAppBundleId,
    `${watchAppName}/${watchAppName}.entitlements`,
    '9.0',
    'watchos'
  )

  configureTargetBuildSettings(
    project,
    watchWidgetTarget,
    watchWidgetName,
    watchWidgetBundleId,
    `${watchWidgetName}/${watchWidgetName}.entitlements`,
    '9.0',
    'watchos'
  )
}

function addFileReference(project, fileName, groupKey) {
  if (!project.hasFile(fileName)) {
    project.addFile(fileName, groupKey)
  }
}

function withIosWatchTargets(config) {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults
    const projectRoot = modConfig.modRequest.projectRoot
    const iosDirectory = modConfig.modRequest.platformProjectRoot
    const mainGroupName = modConfig.modRequest.projectName
    const mainGroupKey = project.findPBXGroupKey({ name: mainGroupName })

    writeWatchExtensionFiles(projectRoot, iosDirectory)
    addWatchTargetsToXcode(project, mainGroupKey)

    return modConfig
  })
}

module.exports = (config) => {
  let nextConfig = withEasWatchTargets(config)
  nextConfig = withIosWatchAppGroup(nextConfig)
  return withIosWatchTargets(nextConfig)
}
