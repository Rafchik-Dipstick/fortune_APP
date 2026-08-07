# See the sibling Game Center podspec: without this file the module is
# discovered but never compiled, so the StoreKit 2 purchase boundary is absent
# at runtime and every purchase path fails as if the module did not exist.

Pod::Spec.new do |s|
  s.name           = 'FortunenessIap'
  s.version        = '1.0.0'
  s.summary        = 'StoreKit 2 purchase boundary for Fortuneness.'
  s.description    = 'Local Expo module wrapping StoreKit 2 products, purchases, transaction updates, and storefront changes.'
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
