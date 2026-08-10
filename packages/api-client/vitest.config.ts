import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['testing/**/*.{spec,test}.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 99, branches: 98, functions: 99, lines: 99 },
      // Paths are package-relative. The previous globs omitted the `src/`
      // prefix, matched nothing, and left the denominator as "whatever the
      // suites happened to import" — which is why generated code was scored.
      include: ['src/**/*.ts'],
      exclude: [
        // Emitted by `npm run generate:api-client` from the canonical Zod
        // contracts and never hand-edited. Correctness is enforced upstream by
        // Optic lint/diff, the Pact consumer and provider suites, and
        // testing/generated-client.spec.ts. Unit tests over generated fetch
        // wrappers would assert the generator, not this repository's code.
        'src/generated/**',
        // Test helpers published for consumers under the ./testing/* export.
        // They are exercised by the suites that import them; scoring them as
        // product code measures the tests, not the system under test.
        'src/testing/**',
      ],
    },
  },
})
