// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The live font-scale relayout (apps/mobile/src/lib/font-scale-text.tsx) reaches every Text from
// 'react-native' through Metro, on iOS and Android, so no call site changes. The shim reads
// react-native by a private name Metro resolves as the bare one: Metro caches the bare name of
// app code once for every importer (dev client run, 2026-11-16: an origin-based exception handed
// the font-scale Text itself as Text, and Hermes ran out of memory rendering it inside itself),
// and 'react-native/index' is a deep import that LogBox warns about over the screen.
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
  REACT_NATIVE_ENTRY,
  fontScaleTextTarget,
  reactNativeEntryRequest,
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
      REACT_NATIVE_ENTRY,
      'react-native/index',
      'react-native-web',
      'react-native/Libraries/Text/Text',
      'react',
    ])
      assert.equal(fontScaleTextTarget(name, 'ios'), null, name)
  })

  test('the shim and the font-scale Text never ask for the bare react-native at runtime', () => {
    const shim = fs.readFileSync(FONT_SCALE_SHIM, 'utf8')
    assert.equal(REACT_NATIVE_ENTRY, 'react-native-font-scale-entry')
    assert.match(shim, /require\('react-native-font-scale-entry'\)/)
    assert.doesNotMatch(shim, /require\('react-native'\)/)
    const text = fs.readFileSync(path.join(mobile, 'src/lib/font-scale-text.tsx'), 'utf8')
    const imports = [...text.matchAll(/^import (type )?.* from '([^']+)'$/gm)]
    assert.deepEqual(
      imports.filter(([, typeOnly, from]) => from === 'react-native' && !typeOnly),
      []
    )
  })
})

// Android Maestro run 44160911846: the shim's require('react-native/index') made React Native's
// dev Babel preset log a deep-import warning on every bundle load. LogBox showed it as a toast
// over the bottom 200 px of the screen ([26,2144][1054,2348]), and the tap on the silhouette
// "Remove My Form photo" button at (540,2145) landed on the toast: no DELETE ever reached the API.
describe('the shim under the React Native dev Babel preset', () => {
  test('logs no deep-import warning, so LogBox raises no toast over the screen', () => {
    const babel = require('@babel/core')
    const preset = createRequire(require.resolve('babel-preset-expo'))
    const warnOnDeepImports = preset(
      '@react-native/babel-preset/src/plugin-warn-on-deep-imports.js'
    )
    const { code } = babel.transformSync(fs.readFileSync(FONT_SCALE_SHIM, 'utf8'), {
      babelrc: false,
      configFile: false,
      filename: FONT_SCALE_SHIM,
      plugins: [warnOnDeepImports],
    })
    assert.deepEqual(
      code.match(/Deep imports from the 'react-native' package[^"]*/g),
      null
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

describe('reactNativeEntryRequest', () => {
  test("asks Metro's own resolver for the bare react-native for the shim's name only", () => {
    assert.equal(reactNativeEntryRequest(REACT_NATIVE_ENTRY), 'react-native')
    for (const name of [
      'react-native',
      'react-native/index',
      'react',
      'react-native-web',
    ])
      assert.equal(reactNativeEntryRequest(name), null, name)
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

  test("resolves the shim's name through Metro's own resolver as the bare react-native", () => {
    const config = require('./metro.config.js')
    const context = {
      originModulePath: FONT_SCALE_SHIM,
      resolveRequest: (_context, name, platform) => ({
        type: 'sourceFile',
        filePath: `resolved:${name}:${platform}`,
      }),
    }
    for (const platform of ['ios', 'android'])
      assert.deepEqual(
        config.resolver.resolveRequest(context, REACT_NATIVE_ENTRY, platform),
        {
          type: 'sourceFile',
          filePath: `resolved:react-native:${platform}`,
        }
      )
  })
})
