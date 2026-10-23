Pod::Spec.new do |s|
  s.name           = 'AccessibilityFocus'
  s.version        = '1.0.0'
  s.summary        = 'Reports OS accessibility-focus changes by native view tag.'
  s.description    = 'Reports OS accessibility-focus changes by native view tag.'
  s.license        = 'UNLICENSED'
  s.author         = 'CoutureCast'
  s.homepage       = 'https://github.com/muratkeremozcan/couture-cast'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/muratkeremozcan/couture-cast.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.swift'
  # Package.swift and Tests/ run the UIKit decisions under XCTest on their own.
  s.exclude_files = ['Package.swift', 'Tests/**/*']
end
