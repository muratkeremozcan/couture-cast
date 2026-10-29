const fs = require('node:fs')
const path = require('node:path')
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins')

const reference = '@xml/cc68_release_proof_network_security'
const policy = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`

const resourceFile = (mod) =>
  path.join(
    mod.modRequest.platformProjectRoot,
    'app/src/main/res/xml/cc68_release_proof_network_security.xml'
  )

module.exports = (config) => {
  if (process.env.CC68_RELEASE_PROOF_LOOPBACK !== '1') {
    config = withAndroidManifest(config, (mod) => {
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
      const existing = application.$['android:networkSecurityConfig']
      if (existing && /\/cc68_release_proof_network_security$/.test(existing))
        throw new Error('story68_release_network_stale_proof_manifest')
      return mod
    })
    return withDangerousMod(config, [
      'android',
      (mod) => {
        if (fs.existsSync(resourceFile(mod)))
          throw new Error('story68_release_network_stale_proof_resource')
        return mod
      },
    ])
  }
  if (
    process.env.STORY68_NATIVE_TEST_BUILD !== '1' ||
    config.android?.package !== 'com.couturecast.story68' ||
    (process.env.EAS_BUILD_PROFILE &&
      process.env.EAS_BUILD_PROFILE !== 'cc68-release-proof')
  )
    throw new Error('story68_release_network_proof_input_required')
  for (const value of [
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ]) {
    let origin
    try {
      origin = new URL(value)
    } catch {
      throw new Error('story68_release_network_local_origins_required')
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      !['localhost', '127.0.0.1', '10.0.2.2'].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      !['', '/'].includes(origin.pathname) ||
      origin.search ||
      origin.hash
    )
      throw new Error('story68_release_network_local_origins_required')
  }
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    const existing = application.$['android:networkSecurityConfig']
    if (existing && existing !== reference)
      throw new Error('story68_release_network_manifest_conflict')
    application.$['android:networkSecurityConfig'] = reference
    application.$['android:usesCleartextTraffic'] = 'false'
    return mod
  })
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const file = resourceFile(mod)
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== policy)
        throw new Error('story68_release_network_resource_conflict')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, policy)
      return mod
    },
  ])
}
