Pod::Spec.new do |s|
  s.name = 'ShareCardPhotoSave'
  s.version = '1.0.0'
  s.summary = 'Imports an approved original PNG using add-only Photos access.'
  s.description = s.summary
  s.license = 'UNLICENSED'
  s.author = 'CoutureCast'
  s.homepage = 'https://github.com/muratkeremozcan/couture-cast'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { git: 'https://github.com/muratkeremozcan/couture-cast.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Photos', 'CryptoKit'
  s.source_files = '*.swift'
  s.exclude_files = ['Tests/**/*', 'Package.swift']
end
