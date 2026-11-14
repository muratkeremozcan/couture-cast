require 'json'

# Story 6.15 F-00i. Linked only into builds prebuilt with COUTURE_TEXT_LAYOUT_PROBE=1
# (plugins/with-text-layout-probe.js excludes it from use_expo_modules! otherwise).
# TLPParagraphReader.mm reads the paragraph props through React Native's Fabric headers, which
# install_modules_dependencies puts on the header path.
unless defined?(install_modules_dependencies)
  # Defined by react_native_pods.rb; `pod ipc spec` runs without it.
  react_native = File.dirname(`node --print "require.resolve('react-native/package.json')"`)
  require File.join(react_native, 'scripts/react_native_pods')
end

Pod::Spec.new do |s|
  s.name           = 'TextLayoutProbe'
  s.version        = '1.0.0'
  s.summary        = 'Reports the laid-out text of every paragraph view for the live font-scale proof.'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'CoutureCast'
  s.homepage       = 'https://github.com/muratkeremozcan/couture-cast'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/muratkeremozcan/couture-cast.git' }
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-FabricComponents'
  # Merges React Native's header search paths and C++ standard into the config above.
  install_modules_dependencies(s)

  s.source_files = '*.{h,mm,swift}'
  # Package.swift and Tests/ run the wire and TextKit rules under XCTest on their own.
  s.exclude_files = ['Package.swift', 'Tests/**/*']
end
