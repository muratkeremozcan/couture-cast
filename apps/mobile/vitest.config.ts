import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: [
      {
        find: /^@couture\/api-client$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/index.ts'),
      },
      {
        find: /^@couture\/api-client\/realtime\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/realtime/$1'),
      },
      {
        find: /^@couture\/api-client\/types\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/types/$1'),
      },
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
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
})
