# Without this podspec the module is discovered by `expo-modules-autolinking
# search` but dropped by `resolve`, so CocoaPods never compiles the Swift into
# the application. The build then succeeds with no native code, and
# `requireOptionalNativeModule('FortunenessGameCenter')` returns null at
# runtime -- which the app reports as "Game Center is unavailable in Expo Go"
# even on a real development build.

Pod::Spec.new do |s|
  s.name           = 'FortunenessGameCenter'
  s.version        = '1.0.0'
  s.summary        = 'Game Center identity and identity-verification proofs for Fortuneness.'
  s.description    = 'Local Expo module wrapping GKLocalPlayer authentication and fetchItemsForIdentityVerificationSignature.'
  s.author         = 'Fortuneness'
  s.homepage       = 'https://fortuneness.app'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
