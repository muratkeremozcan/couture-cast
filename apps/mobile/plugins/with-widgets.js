// Story 3.3 Task 2 owner: generate both native widget integrations during Expo prebuild.
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withMainApplication,
  withXcodeProject,
} = require('@expo/config-plugins')
const plist = require('@expo/plist').default
const fs = require('fs')
const path = require('path')

const appGroup = 'group.com.anonymous.mobile'
const extensionName = 'OutfitWidget'
const extensionBundleIdentifier = 'com.anonymous.mobile.OutfitWidget'
const androidWidgetClasses = [
  'OutfitWidgetProvider',
  'OutfitWidgetProviderSmall',
  'OutfitWidgetProviderMedium',
  'WidgetSharedModule',
  'WidgetSharedPackage',
]

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

function withEasWidgetExtension(config) {
  const eas = config.extra?.eas ?? {}
  const build = eas.build ?? {}
  const experimental = build.experimental ?? {}
  const ios = experimental.ios ?? {}
  const appExtensions = Array.isArray(ios.appExtensions) ? [...ios.appExtensions] : []
  const widgetExtension = {
    targetName: extensionName,
    bundleIdentifier: extensionBundleIdentifier,
    entitlements: {
      'com.apple.security.application-groups': [appGroup],
    },
  }
  const existingIndex = appExtensions.findIndex(
    (entry) => entry?.targetName === extensionName
  )
  if (existingIndex >= 0) {
    appExtensions[existingIndex] = widgetExtension
  } else {
    appExtensions.push(widgetExtension)
  }
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

function withWidgetEntitlements(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    const currentGroups = modConfig.modResults['com.apple.security.application-groups']
    const groups = Array.isArray(currentGroups) ? currentGroups : []
    modConfig.modResults['com.apple.security.application-groups'] = [
      ...new Set([...groups, appGroup]),
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
    mainGroup.children.push({ value: group.uuid, comment: extensionName })
  }
}

function addFileReference(project, fileName, groupKey) {
  if (!project.hasFile(fileName)) {
    project.addFile(fileName, groupKey)
  }
}

function configureExtensionBuildSettings(project, target) {
  const configurationList =
    project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList]
  const configurations = project.pbxXCBuildConfigurationSection()
  for (const configurationReference of configurationList.buildConfigurations) {
    const configuration = configurations[configurationReference.value]
    Object.assign(configuration.buildSettings, {
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CODE_SIGN_ENTITLEMENTS: `"${extensionName}/${extensionName}.entitlements"`,
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: '1',
      GENERATE_INFOPLIST_FILE: 'NO',
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: `"${extensionBundleIdentifier}"`,
      PRODUCT_NAME: `"${extensionName}"`,
      SKIP_INSTALL: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    })
  }
}

function writeIosExtensionFiles(projectRoot, iosDirectory) {
  const sourceDirectory = path.join(projectRoot, 'targets/widgets')
  const destinationDirectory = path.join(iosDirectory, extensionName)
  ensureDirectory(destinationDirectory)
  copyFile(
    path.join(sourceDirectory, 'OutfitWidget.swift'),
    path.join(destinationDirectory, 'OutfitWidget.swift')
  )
  copyFile(
    resolveSpaceGroteskFont(projectRoot),
    path.join(destinationDirectory, 'SpaceGrotesk-Regular.ttf')
  )
  fs.writeFileSync(
    path.join(destinationDirectory, `${extensionName}-Info.plist`),
    plist.build({
      CFBundleDisplayName: 'CoutureCast',
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
      UIAppFonts: ['SpaceGrotesk-Regular.ttf'],
    })
  )
  fs.writeFileSync(
    path.join(destinationDirectory, `${extensionName}.entitlements`),
    plist.build({
      'com.apple.security.application-groups': [appGroup],
    })
  )
}

function addIosExtensionTarget(project, mainGroupKey) {
  let target = findTarget(project, extensionName)
  if (!target) {
    target = project.addTarget(
      extensionName,
      'app_extension',
      extensionName,
      extensionBundleIdentifier
    )
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)
  }

  let groupKey = project.findPBXGroupKey({ name: extensionName })
  if (!groupKey) {
    const group = project.addPbxGroup([], extensionName, extensionName)
    groupKey = group.uuid
    addGroupToMainGroup(project, mainGroupKey, group)
  }

  if (!project.hasFile('OutfitWidget.swift')) {
    project.addSourceFile('OutfitWidget.swift', { target: target.uuid }, groupKey)
  }
  if (!project.hasFile('SpaceGrotesk-Regular.ttf')) {
    const fontFile = project.addFile('SpaceGrotesk-Regular.ttf', groupKey)
    fontFile.target = target.uuid
    fontFile.uuid = project.generateUuid()
    fontFile.group = 'Resources'
    project.addToPbxBuildFileSection(fontFile)
    project.addToPbxResourcesBuildPhase(fontFile)
  }
  addFileReference(project, `${extensionName}-Info.plist`, groupKey)
  addFileReference(project, `${extensionName}.entitlements`, groupKey)
  configureExtensionBuildSettings(project, target)
}

function addIosBridgeFiles(project, projectRoot, iosDirectory, mainGroupName) {
  const sourceDirectory = path.join(projectRoot, 'targets/widgets')
  const destinationDirectory = path.join(iosDirectory, mainGroupName, 'WidgetBridge')
  const mainGroupKey = project.findPBXGroupKey({ name: mainGroupName })
  ensureDirectory(destinationDirectory)

  for (const fileName of ['WidgetSharedModule.swift', 'WidgetSharedModule.m']) {
    copyFile(
      path.join(sourceDirectory, fileName),
      path.join(destinationDirectory, fileName)
    )
    const relativePath = path.join(mainGroupName, 'WidgetBridge', fileName)
    if (!project.hasFile(relativePath)) {
      project.addSourceFile(relativePath, null, mainGroupKey)
    }
  }
  return mainGroupKey
}

function withIosWidgetFiles(config) {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults
    const projectRoot = modConfig.modRequest.projectRoot
    const iosDirectory = modConfig.modRequest.platformProjectRoot
    const mainGroupName = modConfig.modRequest.projectName
    writeIosExtensionFiles(projectRoot, iosDirectory)
    const mainGroupKey = addIosBridgeFiles(
      project,
      projectRoot,
      iosDirectory,
      mainGroupName
    )
    addIosExtensionTarget(project, mainGroupKey)
    return modConfig
  })
}

function widgetReceiver(name, metadataResource) {
  return {
    $: {
      'android:name': `.${name}`,
      'android:exported': 'false',
    },
    'intent-filter': [
      {
        action: [
          {
            $: {
              'android:name': 'android.appwidget.action.APPWIDGET_UPDATE',
            },
          },
        ],
      },
    ],
    'meta-data': [
      {
        $: {
          'android:name': 'android.appwidget.provider',
          'android:resource': metadataResource,
        },
      },
    ],
  }
}

function withAndroidWidgetManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      modConfig.modResults
    )
    const receivers = application.receiver ?? []
    const widgetReceivers = [
      widgetReceiver('OutfitWidgetProviderSmall', '@xml/widget_info_small'),
      widgetReceiver('OutfitWidgetProviderMedium', '@xml/widget_info_medium'),
    ]
    for (const receiver of widgetReceivers) {
      const receiverName = receiver.$['android:name']
      const existingIndex = receivers.findIndex(
        (entry) => entry.$?.['android:name'] === receiverName
      )
      if (existingIndex >= 0) {
        receivers[existingIndex] = receiver
      } else {
        receivers.push(receiver)
      }
    }
    application.receiver = receivers
    return modConfig
  })
}

function withAndroidWidgetPackage(config) {
  return withMainApplication(config, (modConfig) => {
    if (modConfig.modResults.language !== 'kt') {
      throw new Error('The CoutureCast widget plugin requires MainApplication.kt')
    }
    const packageRegistration = 'add(WidgetSharedPackage())'
    if (!modConfig.modResults.contents.includes(packageRegistration)) {
      const packageListPattern = /(PackageList\(this\)\.packages\.apply\s*\{)/
      if (!packageListPattern.test(modConfig.modResults.contents)) {
        throw new Error('Unable to locate the React Native package list')
      }
      modConfig.modResults.contents = modConfig.modResults.contents.replace(
        packageListPattern,
        `$1\n              ${packageRegistration}`
      )
    }
    return modConfig
  })
}

function withAndroidWidgetFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot
      const androidDirectory = modConfig.modRequest.platformProjectRoot
      const packageName = modConfig.android?.package
      if (!packageName) {
        throw new Error('android.package is required for widget generation')
      }
      const sourceDirectory = path.join(projectRoot, 'targets/widgets/android')
      const javaDirectory = path.join(
        androidDirectory,
        'app/src/main/java',
        ...packageName.split('.')
      )
      for (const className of androidWidgetClasses) {
        copyFile(
          path.join(sourceDirectory, 'java', `${className}.kt`),
          path.join(javaDirectory, `${className}.kt`)
        )
      }
      fs.cpSync(
        path.join(sourceDirectory, 'res'),
        path.join(androidDirectory, 'app/src/main/res'),
        { recursive: true }
      )
      copyFile(
        resolveSpaceGroteskFont(projectRoot),
        path.join(androidDirectory, 'app/src/main/res/font/space_grotesk.ttf')
      )
      return modConfig
    },
  ])
}

module.exports = (config) => {
  let nextConfig = withEasWidgetExtension(config)
  nextConfig = withWidgetEntitlements(nextConfig)
  nextConfig = withIosWidgetFiles(nextConfig)
  nextConfig = withAndroidWidgetManifest(nextConfig)
  nextConfig = withAndroidWidgetPackage(nextConfig)
  return withAndroidWidgetFiles(nextConfig)
}
