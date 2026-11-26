/// <reference types="vite/client" />
// Story CC-7.7 (TEA): the native sources the motion budget guard scans (motion-budget.test.ts).
// The mobile suite runs in a browser, so Vite inlines them at build time. An ES module file,
// because the app's .ts files compile as CommonJS, where import.meta is not allowed.
// Plain JavaScript syntax on purpose: the mobile browser run serves this file without a
// TypeScript transform, so a type annotation here failed the import (CI, 61d7156e).
export const motionSources = import.meta.glob(
  [
    '../../app/**/*.{ts,tsx}',
    '../../src/**/*.{ts,tsx}',
    '../../components/**/*.{ts,tsx}',
    '!**/*.{test,spec}.{ts,tsx}',
    '!**/*.test-support.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true }
)
