// Story 6.5 owner: Xcode 27 rejects transitive pod deployment targets below supported iOS.
const { withPodfile } = require('@expo/config-plugins')
const marker = '# CoutureCast supported iOS pod targets'
module.exports = (config) =>
  withPodfile(config, (mod) => {
    if (mod.modResults.contents.includes(marker)) return mod
    const anchor = /(:ccache_enabled => ccache_enabled\?\(podfile_properties\),\s*\))/
    if (!anchor.test(mod.modResults.contents))
      throw new Error('React Native Podfile post-install anchor changed')
    mod.modResults.contents = mod.modResults.contents.replace(
      anchor,
      `$1
    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |configuration|
        current = configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && current.match?(/\\A\\d+(?:\\.\\d+)*\\z/) && Gem::Version.new(current) < Gem::Version.new('15.1')
          configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end`
    )
    return mod
  })
