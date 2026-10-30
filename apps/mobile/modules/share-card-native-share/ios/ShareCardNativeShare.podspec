Pod::Spec.new do |s|
  s.name = 'ShareCardNativeShare'
  s.version = '1.0.0'
  s.summary = 'Hands one validated share-card PNG to the iOS share sheet and reports a closed result.'
  s.description = s.summary
  s.license = 'UNLICENSED'
  s.author = 'CoutureCast'
  s.homepage = 'https://github.com/muratkeremozcan/couture-cast'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { git: 'https://github.com/muratkeremozcan/couture-cast.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'CryptoKit'
  s.source_files = '*.swift'
  # Package.swift and Tests/ run the pure mapping, anchor and file decisions under XCTest alone.
  s.exclude_files = ['Tests/**/*', 'Package.swift']
end
