import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['testing/**/*.{spec,test}.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['*.ts', 'contracts/**/*.ts', 'realtime/**/*.ts', 'types/**/*.ts'],
    },
  },
})
