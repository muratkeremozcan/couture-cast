// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { describe, test } = require('node:test')
const { parseStringPromise } = require('xml2js')
const {
  assertCommand,
  createExpoPrebuildFixture,
  repositoryRoot,
} = require('./prebuild-test-helpers')
const cli = require.resolve('expo/bin/cli', { paths: [repositoryRoot] })

function generate(t, override = {}, edit = () => undefined) {
  const root = createExpoPrebuildFixture(t, {
    prefix: 'couture-story68-release-network-',
    entries: [
      'app.config.ts',
      'app.json',
      'package.json',
      'plugins',
      'targets',
      'assets',
      'locales',
    ],
  })
  edit(root)
  return { root, result: prebuild(root, override) }
}
function prebuild(root, override = {}, clean = true) {
  return spawnSync(
    process.execPath,
    [
      cli,
      'prebuild',
      ...(clean ? ['--clean'] : []),
      '--platform',
      'android',
      '--no-install',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        CI: '1',
        EXPO_NO_TELEMETRY: '1',
        EXPO_NO_DOTENV: '1',
        NODE_ENV: 'production',
        STORY65_NATIVE_TEST_BUILD: '0',
        STORY68_NATIVE_TEST_BUILD: '0',
        CC68_RELEASE_PROOF_LOOPBACK: '0',
        EAS_BUILD_PROFILE: 'production',
        FIREBASE_GOOGLE_SERVICES_FILE: '',
        EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:53068',
        ...override,
      },
    }
  )
}
const proofEnv = {
  STORY68_NATIVE_TEST_BUILD: '1',
  CC68_RELEASE_PROOF_LOOPBACK: '1',
  EAS_BUILD_PROFILE: '',
}
async function manifest(root) {
  return parseStringPromise(
    fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
  )
}

async function assertProductionPolicy(root) {
  const app = (await manifest(root)).manifest.application[0].$
  assert.equal(
    app['android:networkSecurityConfig'],
    undefined,
    'Production must have no proof network exception'
  )
  assert.notEqual(app['android:usesCleartextTraffic'], 'true')
  assert.notEqual(app['android:debuggable'], 'true')
  assert.equal(
    fs.existsSync(
      path.join(
        root,
        'android/app/src/main/res/xml/cc68_release_proof_network_security.xml'
      )
    ),
    false
  )
}

describe('story68 release network plugin', () => {
  test(
    'fresh isolated Release-proof prebuild writes only the exact loopback domain exception',
    { timeout: 90000 },
    async (t) => {
      const { root, result } = generate(t, proofEnv)
      assertCommand(result, 'Isolated Release-proof prebuild failed')
      const app = (await manifest(root)).manifest.application[0].$
      assert.equal(
        app['android:networkSecurityConfig'],
        '@xml/cc68_release_proof_network_security'
      )
      assert.equal(app['android:usesCleartextTraffic'], 'false')
      assert.notEqual(app['android:debuggable'], 'true')
      const policy = await parseStringPromise(
        fs.readFileSync(
          path.join(
            root,
            'android/app/src/main/res/xml/cc68_release_proof_network_security.xml'
          ),
          'utf8'
        )
      )
      const network = policy['network-security-config']
      assert.deepEqual(Object.keys(network).sort(), ['base-config', 'domain-config'])
      assert.equal(network['base-config'].length, 1)
      assert.equal(network['base-config'][0].$.cleartextTrafficPermitted, 'false')
      assert.deepEqual(network['base-config'][0]['trust-anchors'], [
        { certificates: [{ $: { src: 'system' } }] },
      ])
      assert.equal(network['domain-config'].length, 1)
      assert.equal(network['domain-config'][0].$.cleartextTrafficPermitted, 'true')
      assert.deepEqual(
        network['domain-config'][0].domain,
        ['localhost', '127.0.0.1', '10.0.2.2'].map((name) => ({
          _: name,
          $: { includeSubdomains: 'false' },
        }))
      )
    }
  )

  test(
    'production policy assertion rejects actual isolated output and accepts fresh flag-off production',
    { timeout: 90000 },
    async (t) => {
      const isolated = generate(t, proofEnv)
      assertCommand(isolated.result, 'Isolated counterfactual prebuild failed')
      await assert.rejects(
        assertProductionPolicy(isolated.root),
        /Production must have no proof network exception/
      )
      console.log(
        'Production policy RED observed against actual isolated generated manifest'
      )
      const production = generate(t)
      assertCommand(production.result, 'Production prebuild failed')
      await assertProductionPolicy(production.root)
      console.log('Production policy GREEN observed with proof input off')
    }
  )

  test(
    'Story68 identity without the separate proof input has no network exception',
    { timeout: 90000 },
    async (t) => {
      const normalIsolated = generate(t, { STORY68_NATIVE_TEST_BUILD: '1' })
      assertCommand(normalIsolated.result, 'Normal isolated prebuild failed')
      await assertProductionPolicy(normalIsolated.root)
    }
  )

  test(
    'proof input rejects production, release and unrelated EAS profiles before native generation',
    { timeout: 90000 },
    (t) => {
      for (const profile of ['production', 'release', 'development']) {
        const { root, result } = generate(t, { ...proofEnv, EAS_BUILD_PROFILE: profile })
        assert.notEqual(result.status, 0)
        assert.match(
          result.stderr,
          /Release loopback requires an isolated local proof build/
        )
        assert.equal(fs.existsSync(path.join(root, 'android')), false)
      }
    }
  )

  test(
    'proof input requires the isolated flag and existing loopback API and Auth guards',
    { timeout: 90000 },
    (t) => {
      for (const [override, message] of [
        [
          { STORY68_NATIVE_TEST_BUILD: '0' },
          /Release loopback requires an isolated local proof build/,
        ],
        [
          { EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test' },
          /explicit local API and Auth origins/,
        ],
        [
          { EXPO_PUBLIC_SUPABASE_URL: 'https://auth.example.test' },
          /explicit local API and Auth origins/,
        ],
        [
          { EXPO_PUBLIC_API_BASE_URL: 'ftp://127.0.0.1:4088' },
          /story68_release_network_local_origins_required/,
        ],
      ]) {
        const { result } = generate(t, { ...proofEnv, ...override })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, message, JSON.stringify(override))
      }
    }
  )

  for (const kind of ['manifest', 'resource']) {
    test(
      `existing conflicting ${kind} policy is rejected by a fresh proof prebuild`,
      { timeout: 90000 },
      (t) => {
        const { result } = generate(t, proofEnv, (root) => {
          const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')))
          app.expo.plugins.push('./plugins/with-network-conflict')
          fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify(app))
          const plugin =
            kind === 'manifest'
              ? `const { withAndroidManifest } = require('@expo/config-plugins')
module.exports = config => withAndroidManifest(config, mod => { mod.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/existing_policy'; return mod })`
              : `const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod } = require('@expo/config-plugins')
module.exports = config => withDangerousMod(config, ['android', mod => { const file = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml/cc68_release_proof_network_security.xml'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '<network-security-config />'); return mod }])`
          fs.writeFileSync(path.join(root, 'plugins/with-network-conflict.js'), plugin)
        })
        assert.notEqual(result.status, 0)
        assert.match(
          result.stderr,
          new RegExp(`story68_release_network_${kind}_conflict`)
        )
      }
    )
  }

  test('Release fixture gate stays disabled and EAS profiles never set the proof input', () => {
    const ts = require('typescript')
    const vm = require('node:vm')
    const source = fs.readFileSync(
      path.join(__dirname, '../src/lib/share-card-native-fixture-url.ts'),
      'utf8'
    )
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const context = { exports: {}, URL }
    vm.runInNewContext(javascript, context)
    assert.equal(
      context.exports.isShareCardNativeFixtureBuild(
        false,
        'com.couturecast.story68',
        true
      ),
      false
    )
    const nativeSource = fs.readFileSync(
      path.join(__dirname, '../src/lib/share-card-native-fixture.native.ts'),
      'utf8'
    )
    assert.match(nativeSource, /isShareCardNativeFixtureBuild\(\s*__DEV__,/)
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '../eas.json')))
    assert.deepEqual(Object.keys(eas.build).sort(), ['development', 'production'])
    for (const profile of Object.values(eas.build)) {
      assert.notEqual(profile.env?.CC68_RELEASE_PROOF_LOOPBACK, '1')
      assert.notEqual(profile.env?.STORY68_NATIVE_TEST_BUILD, '1')
    }
  })

  test(
    'same-project proof then flag-off non-clean production prebuild fails closed; clean production passes',
    { timeout: 90000 },
    async (t) => {
      const { root, result } = generate(t, proofEnv)
      assertCommand(result, 'Initial isolated proof generation failed')
      const reused = prebuild(root, {}, false)
      assert.notEqual(
        reused.status,
        0,
        'Reused proof policy must block flag-off production generation'
      )
      assert.match(reused.stderr, /story68_release_network_stale_proof/)
      const clean = prebuild(root)
      assertCommand(clean, 'Clean production generation failed')
      await assertProductionPolicy(root)
    }
  )

  for (const stale of ['manifest', 'resource']) {
    test(
      `flag-off non-clean generation rejects a stale proof ${stale} independently`,
      { timeout: 90000 },
      (t) => {
        const { root, result } = generate(t, proofEnv)
        assertCommand(result, 'Initial isolated proof generation failed')
        const resource = path.join(
          root,
          'android/app/src/main/res/xml/cc68_release_proof_network_security.xml'
        )
        const manifestFile = path.join(root, 'android/app/src/main/AndroidManifest.xml')
        if (stale === 'manifest') fs.unlinkSync(resource)
        else {
          const content = fs.readFileSync(manifestFile, 'utf8')
          assert.ok(
            content.includes(
              'android:networkSecurityConfig="@xml/cc68_release_proof_network_security"'
            )
          )
          fs.writeFileSync(
            manifestFile,
            content.replace(
              'android:networkSecurityConfig="@xml/cc68_release_proof_network_security"',
              ''
            )
          )
        }
        const reused = prebuild(root, {}, false)
        assert.notEqual(reused.status, 0)
        assert.match(
          reused.stderr,
          new RegExp(`story68_release_network_stale_proof_${stale}`)
        )
      }
    )
  }

  test(
    'flag-off guard preserves an unrelated normal Android network configuration',
    { timeout: 90000 },
    async (t) => {
      const { root, result } = generate(t, {}, (root) => {
        const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')))
        app.expo.plugins.push('./plugins/with-normal-network')
        fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify(app))
        fs.writeFileSync(
          path.join(root, 'plugins/with-normal-network.js'),
          `
const { withAndroidManifest } = require('@expo/config-plugins')
module.exports = config => withAndroidManifest(config, mod => {
  mod.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/normal_policy'
  return mod
})
`
        )
      })
      assertCommand(result, 'Normal configuration prebuild failed')
      const app = (await manifest(root)).manifest.application[0].$
      assert.equal(app['android:networkSecurityConfig'], '@xml/normal_policy')
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            'android/app/src/main/res/xml/cc68_release_proof_network_security.xml'
          )
        ),
        false
      )
    }
  )
})
