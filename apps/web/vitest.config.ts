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
        replacement: path.resolve(__dirname, '../../packages/api-client/testing/$1'),
      },
      {
        find: /^@couture\/api-client\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/$1'),
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
  },
})
