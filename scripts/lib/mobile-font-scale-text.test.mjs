// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The live font-scale relayout (apps/mobile/src/lib/font-scale-text.tsx) reaches every Text from
// 'react-native' through Metro, on iOS and Android, so no call site changes. The shim reads
// react-native as 'react-native/index': Metro caches the bare name of app code once for every
// importer (dev client run, 2026-11-16: an origin-based exception handed the font-scale Text
// itself as Text, and Hermes ran out of memory rendering it inside itself).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mobile = path.join(root, 'apps/mobile')
const require = createRequire(path.join(mobile, 'package.json'))
const {
  FONT_SCALE_SHIM,
  fontScaleTextTarget,
  withAnimatedText,
  withFontScaleText,
} = require('./metro-font-scale-text.js')

const app = path.join(mobile, 'app/(tabs)/index.tsx')

describe('fontScaleTextTarget', () => {
  test("sends the bare 'react-native' to the shim on iOS and Android", () => {
    for (const platform of ['ios', 'android'])
      assert.equal(fontScaleTextTarget('react-native', platform), FONT_SCALE_SHIM)
  })

  test('leaves web, other modules, deep imports and the name the shim reads alone', () => {
    for (const platform of ['web', null, undefined])
      assert.equal(fontScaleTextTarget('react-native', platform), null)
    for (const name of [
      'react-native/index',
      'react-native-web',
      'react-native/Libraries/Text/Text',
      'react',
    ])
      assert.equal(fontScaleTextTarget(name, 'ios'), null, name)
  })

  test('the shim and the font-scale Text never ask for the bare react-native at runtime', () => {
    const shim = fs.readFileSync(FONT_SCALE_SHIM, 'utf8')
    assert.match(shim, /require\('react-native\/index'\)/)
    assert.doesNotMatch(shim, /require\('react-native'\)/)
    const text = fs.readFileSync(path.join(mobile, 'src/lib/font-scale-text.tsx'), 'utf8')
    const imports = [...text.matchAll(/^import (type )?.* from '([^']+)'$/gm)]
    assert.deepEqual(
      imports.filter(([, typeOnly, from]) => from === 'react-native' && !typeOnly),
      []
    )
  })
})

describe('withFontScaleText', () => {
  test('keeps every export lazily and supplies the font-scale Text in place of Text', () => {
    const read = []
    const real = {}
    for (const name of ['View', 'Text', 'Platform'])
      Object.defineProperty(real, name, {
        enumerable: true,
        get: () => {
          read.push(name)
          return `real ${name}`
        },
      })
    let loaded = 0
    const shim = withFontScaleText(real, {
      Text: () => {
        loaded += 1
        return 'FontScaleText'
      },
    })
    assert.deepEqual(Object.keys(shim).sort(), ['Platform', 'Text', 'View'])
    assert.deepEqual([read, loaded], [[], 0], 'nothing is read before it is used')
    assert.equal(shim.View, 'real View')
    assert.equal(shim.Text, 'FontScaleText')
    assert.deepEqual([read, loaded], [['View'], 1], 'the real Text is never read')
  })
})

// iOS dispatch 43852018196: with Text replaced, Settings' header title still kept its launch
// height (20 pt where a cold launch measures 28), since React Navigation draws it with
// Animated.Text, which React Native builds from its own Text, not from 'react-native'.
describe('withAnimatedText', () => {
  test('gives Animated a Text animated from the font-scale Text and keeps the rest', () => {
    const read = []
    const real = {}
    for (const name of ['View', 'Text', 'timing'])
      Object.defineProperty(real, name, {
        enumerable: true,
        get: () => {
          read.push(name)
          return `real ${name}`
        },
      })
    real.createAnimatedComponent = (component) => `animated ${component}`
    const animated = withAnimatedText(real, () => 'FontScaleText')
    assert.deepEqual(read, [], 'nothing is read before it is used')
    assert.deepEqual(Object.keys(animated).sort(), [
      'Text',
      'View',
      'createAnimatedComponent',
      'timing',
    ])
    assert.equal(animated.Text, 'animated FontScaleText')
    assert.equal(animated.Text, animated.Text, 'one component, so React keeps its state')
    assert.equal(animated.View, 'real View')
    assert.equal(animated.timing, 'real timing')
    assert.deepEqual(read, ['View', 'timing'], 'the real Animated.Text is never read')
  })

  test('the shim hands react-native exports Animated through withAnimatedText', () => {
    const shim = fs.readFileSync(FONT_SCALE_SHIM, 'utf8')
    assert.match(shim, /Animated: \(\) =>/)
    assert.match(shim, /withAnimatedText\(reactNative\.Animated, loadText\)/)
  })
})

describe('metro.config.js', () => {
  test('resolves the bare react-native through the shim on native, as Metro would on web', () => {
    const config = require('./metro.config.js')
    const context = {
      originModulePath: app,
      resolveRequest: (_context, name) => ({
        type: 'sourceFile',
        filePath: `resolved:${name}`,
      }),
    }
    assert.deepEqual(config.resolver.resolveRequest(context, 'react-native', 'ios'), {
      type: 'sourceFile',
      filePath: FONT_SCALE_SHIM,
    })
    for (const [name, platform] of [
      ['react-native', 'web'],
      ['react-native/index', 'ios'],
    ])
      assert.deepEqual(config.resolver.resolveRequest(context, name, platform), {
        type: 'sourceFile',
        filePath: `resolved:${name}`,
      })
  })
})
