// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S0-01 (CX-14): the semantic prebuild comparison accepts exactly the documented difference of
// the app.json key removal and rejects any other native change.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import { APP_JSON_KEY_REMOVAL_RULE, comparePrebuilds } from './prebuild-semantic-diff.mjs'

/**
 * A minimal Xcode project: one target with two shell phases and a configuration list pointing at
 * one of two Release configurations. `ids` stands in for the IDs prebuild draws at random.
 */
function PBX({
  ids = 'ABCDEFGH',
  phases = ['generate', 'consume'],
  release = 'original',
} = {}) {
  const id = (key) => ids['ABCDEFGH'.indexOf(key)].repeat(24)
  const phase = { generate: id('B'), consume: id('C') }
  const configuration = { original: id('E'), different: id('F') }
  const lines = [
    '// !$*UTF8*$!',
    '{',
    'archiveVersion = 1;',
    'classes = {',
    '};',
    'objectVersion = 54;',
    'objects = {',
    '/* Begin PBXNativeTarget section */',
    `${id('A')} /* App */ = {`,
    'isa = PBXNativeTarget;',
    `buildConfigurationList = ${id('D')};`,
    'buildPhases = (',
    ...phases.map((name) => `${phase[name]} /* ${name} */,`),
    ');',
    'name = App;',
    '};',
    '/* End PBXNativeTarget section */',
    '/* Begin PBXProject section */',
    `${id('G')} /* Project object */ = {`,
    'isa = PBXProject;',
    'targets = (',
    `${id('A')} /* App */,`,
    ');',
    '};',
    '/* End PBXProject section */',
    '/* Begin PBXShellScriptBuildPhase section */',
    `${id('B')} /* generate */ = {`,
    'isa = PBXShellScriptBuildPhase;',
    'shellScript = "generate";',
    '};',
    `${id('C')} /* consume */ = {`,
    'isa = PBXShellScriptBuildPhase;',
    'shellScript = "consume";',
    '};',
    '/* End PBXShellScriptBuildPhase section */',
    '/* Begin XCBuildConfiguration section */',
    `${id('E')} /* Release */ = {`,
    'isa = XCBuildConfiguration;',
    'buildSettings = {',
    'DEVELOPMENT_TEAM = ORIGINAL;',
    '};',
    'name = Release;',
    '};',
    `${id('F')} /* Release */ = {`,
    'isa = XCBuildConfiguration;',
    'buildSettings = {',
    'DEVELOPMENT_TEAM = DIFFERENT;',
    '};',
    'name = Release;',
    '};',
    '/* End XCBuildConfiguration section */',
    '/* Begin XCConfigurationList section */',
    `${id('D')} /* Build configuration list */ = {`,
    'isa = XCConfigurationList;',
    'buildConfigurations = (',
    `${configuration[release]} /* Release */,`,
    ');',
    '};',
    '/* End XCConfigurationList section */',
    '};',
    `rootObject = ${id('G')} /* Project object */;`,
    '}',
  ]
  return `${lines.join('\n')}\n`
}

function tree(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-prebuild-diff-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const files = {
    'ios/CoutureCast.xcodeproj/project.pbxproj': PBX(),
    'ios/Podfile.properties.json': JSON.stringify(
      { 'expo.jsEngine': 'hermes', newArchEnabled: 'true' },
      null,
      2
    ),
    'ios/Podfile':
      "ENV['RCT_NEW_ARCH_ENABLED'] ||= '0' if podfile_properties['newArchEnabled'] == 'false'\n",
    'android/gradle.properties':
      'newArchEnabled=true\nedgeToEdgeEnabled=true\nexpo.edgeToEdgeEnabled=true\nhermesEnabled=true\n',
    'android/app/src/main/AndroidManifest.xml': '<manifest/>\n',
    ...overrides,
  }
  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  return root
}

const keyRemoved = {
  'ios/CoutureCast.xcodeproj/project.pbxproj': PBX({ ids: 'PQRSTUVW' }),
  'ios/Podfile.properties.json': JSON.stringify({ 'expo.jsEngine': 'hermes' }, null, 2),
}

describe('comparePrebuilds with the app.json key removal rule', () => {
  test('accepts regenerated object IDs and the exact newArchEnabled deletion', (t) => {
    const result = comparePrebuilds(
      tree(t),
      tree(t, keyRemoved),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, [])
    assert.equal(result.normalized, 1)
    assert.equal(result.identical, 3)
  })

  // The seeded mutant the story requires: one unrelated native setting changes.
  test('rejects an unrelated gradle.properties change', (t) => {
    const result = comparePrebuilds(
      tree(t),
      tree(t, {
        ...keyRemoved,
        'android/gradle.properties':
          'newArchEnabled=true\nedgeToEdgeEnabled=true\nexpo.edgeToEdgeEnabled=true\nhermesEnabled=false\n',
      }),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, ['android/gradle.properties: differs'])
  })

  test('rejects turning the New Architecture off on iOS', (t) => {
    const result = comparePrebuilds(
      tree(t),
      tree(t, {
        ...keyRemoved,
        'ios/Podfile.properties.json': JSON.stringify(
          { 'expo.jsEngine': 'hermes', newArchEnabled: 'false' },
          null,
          2
        ),
      }),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, [
      'ios/Podfile.properties.json: newArchEnabled changed',
      'ios/Podfile.properties.json: newArchEnabled must not be false',
    ])
  })

  test('rejects a pbxproj change beyond object IDs', (t) => {
    const changed = PBX({ ids: 'PQRSTUVW' }).replace(
      'DEVELOPMENT_TEAM = ORIGINAL;',
      'DEVELOPMENT_TEAM = ORIGINAL;\nIPHONEOS_DEPLOYMENT_TARGET = 16.4;'
    )
    const result = comparePrebuilds(
      tree(t),
      tree(t, { ...keyRemoved, 'ios/CoutureCast.xcodeproj/project.pbxproj': changed }),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, [
      'ios/CoutureCast.xcodeproj/project.pbxproj: differs beyond object IDs',
    ])
  })

  // R2-02 mutants: each keeps every line's content and changes only an order or the object a
  // reference points to.
  for (const [name, options] of [
    ['reversed build phases', { phases: ['consume', 'generate'] }],
    ['a configuration list retargeted to another Release', { release: 'different' }],
  ]) {
    test(`rejects ${name}`, (t) => {
      const result = comparePrebuilds(
        tree(t),
        tree(t, {
          ...keyRemoved,
          'ios/CoutureCast.xcodeproj/project.pbxproj': PBX({
            ids: 'PQRSTUVW',
            ...options,
          }),
        }),
        APP_JSON_KEY_REMOVAL_RULE
      )
      assert.deepEqual(result.problems, [
        'ios/CoutureCast.xcodeproj/project.pbxproj: differs beyond object IDs',
      ])
    })
  }

  test('rejects a project that does not parse', (t) => {
    const result = comparePrebuilds(
      tree(t),
      tree(t, {
        ...keyRemoved,
        'ios/CoutureCast.xcodeproj/project.pbxproj': '{ objects = ',
      }),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, [
      'ios/CoutureCast.xcodeproj/project.pbxproj: differs beyond object IDs',
    ])
  })

  test('rejects a file added or removed and another property deletion', (t) => {
    const result = comparePrebuilds(
      tree(t),
      tree(t, {
        ...keyRemoved,
        'ios/Podfile.properties.json': '{}',
        'android/app/src/main/AndroidManifest.xml': null,
        'android/app/src/main/res/xml/extra.xml': '<x/>\n',
      }),
      APP_JSON_KEY_REMOVAL_RULE
    )
    assert.deepEqual(result.problems, [
      'android/app/src/main/AndroidManifest.xml: missing after',
      'android/app/src/main/res/xml/extra.xml: added after',
      'ios/Podfile.properties.json: expo.jsEngine changed',
    ])
  })

  test('fails an effective setting that a default would no longer supply', (t) => {
    const before = tree(t, {
      'android/gradle.properties': 'newArchEnabled=true\nexpo.edgeToEdgeEnabled=true\n',
    })
    const after = tree(t, {
      ...keyRemoved,
      'android/gradle.properties': 'newArchEnabled=true\nexpo.edgeToEdgeEnabled=true\n',
    })
    assert.deepEqual(
      comparePrebuilds(before, after, APP_JSON_KEY_REMOVAL_RULE).problems,
      ['android/gradle.properties: edgeToEdgeEnabled is undefined, expected true']
    )
  })
})
