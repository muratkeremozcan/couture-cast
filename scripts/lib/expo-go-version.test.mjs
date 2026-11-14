// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

import { EXPO_GO_VERSION, expoGoApkUrl } from './expo-go-version.mjs'

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

test('the Expo Go pin runs the same SDK major as the app', () => {
  const range = JSON.parse(read('../../apps/mobile/package.json')).dependencies.expo
  const expoMajor = /^[~^]?(\d+)\./.exec(range)?.[1]
  assert.ok(expoMajor, `unreadable expo range ${range}`)
  assert.equal(EXPO_GO_VERSION.split('.')[0], expoMajor)
})

test('the APK URL names the pinned release', () => {
  assert.equal(
    expoGoApkUrl(),
    `https://github.com/expo/expo-go-releases/releases/download/Expo-Go-${EXPO_GO_VERSION}/Expo-Go-${EXPO_GO_VERSION}.apk`
  )
})

test('the installer and the Maestro runner read the shared pin and name no version of their own', () => {
  for (const script of ['../install-expo-go.mjs', '../run-maestro.mjs']) {
    const source = read(script)
    assert.match(source, /from '\.\/lib\/expo-go-version\.mjs'/, script)
    assert.doesNotMatch(source, /Expo-Go-\d|'\d+\.\d+\.\d+'.*[Ee]xpo/, script)
  }
})
