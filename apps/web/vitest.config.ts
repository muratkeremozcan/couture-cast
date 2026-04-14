import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  optimizeDeps: {
    include: ['react/jsx-dev-runtime'],
  },
  resolve: {
    alias: [
      {
        find: /^@couture\/api-client$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/index.ts'),
      },
      {
        find: /^@couture\/api-client\/testing\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/testing/$1'),
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
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
})
