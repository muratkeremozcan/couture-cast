import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: [
      {
        find: /^react-native$/,
        replacement: 'react-native-web',
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './'),
      },
    ],
  },
  define: {
    __DEV__: JSON.stringify(true),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['components/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    },
  },
})
