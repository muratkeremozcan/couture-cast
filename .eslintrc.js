module.exports = {
  root: true,
  extends: ['@couture/eslint-config'],
  parserOptions: {
    project: [
      './tsconfig.json',
      './apps/mobile/tsconfig.json',
      './apps/web/tsconfig.json',
      './apps/api/tsconfig.json',
      './playwright/tsconfig.json',
      './pact/tsconfig.json',
    ],
    tsconfigRootDir: __dirname,
  },
  settings: {
    'import/resolver': {
      typescript: {
        noWarnOnMultipleProjects: true,
        project: [
          './tsconfig.json',
          './apps/mobile/tsconfig.eslint.json',
          './apps/web/tsconfig.eslint.json',
          './apps/api/tsconfig.eslint.json',
          './packages/db/tsconfig.json',
          './packages/testing/tsconfig.typecheck.json',
          './packages/utils/tsconfig.typecheck.json',
          './playwright/tsconfig.eslint.json',
          './pact/tsconfig.json',
        ],
      },
    },
  },
  overrides: [
    {
      files: ['**/*.{spec,test}.{ts,tsx}'],
      rules: {
        // Post-task consistency follow-through:
        // allow top-level test registration calls without muting real floating promises inside
        // test bodies.
        '@typescript-eslint/no-floating-promises': [
          'error',
          {
            allowForKnownSafeCalls: ['test', 'it', 'describe'],
          },
        ],
      },
    },
    {
      files: ['apps/mobile/**/*.{spec,test}.{ts,tsx}'],
      rules: {
        // Mobile browser component tests use dynamic renderer and mock APIs.
        'import/named': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
    {
      files: ['apps/api/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./apps/api/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./apps/web/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['apps/mobile/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./apps/mobile/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['packages/db/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./packages/db/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['packages/testing/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./packages/testing/tsconfig.typecheck.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['packages/utils/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./packages/utils/tsconfig.typecheck.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['playwright/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./playwright/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['pact/**/*.{ts,tsx,mts}'],
      parserOptions: {
        project: ['./pact/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['k6/**/*.ts', 'packages/k6-utils/src/**/*.ts'],
      parserOptions: {
        project: ['./k6/tsconfig.json', './packages/k6-utils/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
      rules: {
        // k6 jslib CDN imports (https://jslib.k6.io/...) are fetched at runtime by k6
        'import/no-unresolved': ['error', { ignore: ['^https://jslib\\.k6\\.io/'] }],
        // k6 native modules (k6/http, k6/crypto, k6/encoding) use default imports by convention
        'import/no-named-as-default-member': 'off',
        // k6 utility functions legitimately exceed the complexity ceiling
        complexity: 'off',
        // noUncheckedIndexedAccess causes false positives for ! on array/record accesses;
        // tsc is the authoritative type-safety guard for k6 files
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      },
    },
    {
      // Hermes ships no `Intl.ListFormat` and no `Intl.Segmenter`; both are optional
      // under ECMA-402. Constructing either on a device throws
      // `TypeError: Cannot read property 'prototype' of undefined`, which takes the
      // whole screen down and surfaces only as a missing element in a Maestro flow.
      // This has cost the project twice: `Intl.Segmenter` at module scope in the
      // wardrobe contract, and `Intl.ListFormat` in the settings palette list.
      // Feature-detecting `Intl.ListFormat` is still allowed, which is how the shared
      // `formatLocalizedList` helper in @couture/utils works. Only unguarded
      // construction is banned.
      files: ['apps/mobile/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "NewExpression[callee.object.name='Intl'][callee.property.name=/^(ListFormat|Segmenter)$/]",
            message:
              'Hermes ships no Intl.ListFormat or Intl.Segmenter. Use formatLocalizedList from @couture/utils, or feature-detect before constructing.',
          },
        ],
      },
    },
  ],
}
