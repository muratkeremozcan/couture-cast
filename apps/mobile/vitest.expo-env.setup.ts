// Two things Expo's own web toolchain gives every Expo package, which these browser
// suites otherwise lack.
//
// babel-preset-expo inlines process.env.EXPO_OS on every platform. Vitest compiles without
// it, so expo-modules-core warned that EXPO_OS is undefined whenever an Expo package
// loaded. These suites render through react-native-web, so the default is 'web'. This file
// runs before each test file, so a file that simulates a native platform still assigns
// process.env.EXPO_OS in vi.hoisted before Expo packages load.
//
// expo-modules-core installs globalThis.expo from its .web.ts polyfill, which Vite does not
// resolve, so every Expo package a lazy import loaded threw reading
// globalThis.expo.EventEmitter. jest-expo installs the same polyfill through this exported
// entry, which vitest.config.ts prebundles so Vite never re-optimizes it mid-run.
import { installExpoGlobalPolyfill } from 'expo-modules-core/src/polyfill/dangerous-internal'
// expo-constants is web-aware through ExponentConstants.web, which Vite also does not pick.
// The package does not export that file, so it is registered from its built path, the way
// Expo's web build registers it under the native module's name.
import webExponentConstants from '../../node_modules/expo-constants/build/ExponentConstants.web.js'
import { reportMissingExpoGlobalReads } from './src/test-utils/unwanted-console'

process.env.EXPO_OS = 'web'
installExpoGlobalPolyfill()
const expoGlobal = (globalThis as { expo?: { modules: Record<string, unknown> } }).expo
if (expoGlobal) expoGlobal.modules.ExponentConstants ??= webExponentConstants
reportMissingExpoGlobalReads()
