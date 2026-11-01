module.exports = {
  root: true,
  extends: ['@couture/eslint-config'],
  parserOptions: {
    project: [
      './tsconfig.json',
      './apps/mobile/tsconfig.json',
      './apps/web/tsconfig.json',
      './apps/api/tsconfig.json',
      './packages/api-client/tsconfig.json',
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
      // Expo Router mandates this filename and a named `redirectSystemPath` export, so
      // the default-export exemption the other `+` route files rely on does not apply.
      files: ['apps/mobile/app/+native-intent.tsx'],
      rules: { 'filenames/match-regex': 'off' },
    },
    {
      // Repository tooling scripts are plain Node modules outside every tsconfig project,
      // so they lint without type information.
      files: ['**/*.mjs'],
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      env: {
        node: true,
        browser: false,
      },
      rules: {
        // CommonJS packages consumed from ESM (typescript, etc.) are addressed through their
        // default export by convention; the named-export alternative is not reliable interop.
        'import/no-named-as-default-member': 'off',
      },
    },
    {
      files: ['**/*.cjs', 'tools/**/*.js'],
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'commonjs',
      },
      env: {
        node: true,
        browser: false,
      },
    },
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
        // The real useMobileAnalytics memoizes its client, and screens list that client in
        // effect dependencies. A mock hook that builds the client on each call re-runs those
        // effects on every render; under Vitest 5 that brought a dismissed deep-link banner
        // back while the app was correct.
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "Property[key.name='useMobileAnalytics'] > ArrowFunctionExpression > ObjectExpression.body",
            message:
              'A mocked useMobileAnalytics must return one client per module. Use mobileAnalyticsModuleMock from @/src/test-utils/mobile-analytics.',
          },
        ],
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
      // Supertest given a Nest server listens on the dual-stack wildcard and then requests
      // 127.0.0.1. macOS can give that wildcard a port another local process already holds
      // on 127.0.0.1, and that process answers: a foreign 401 failed the wardrobe commit
      // spec, a 404 the ritual spec, a socket hang up the community privacy spec, all only
      // under the full API coverage run. The loopback helper binds 127.0.0.1 itself.
      files: [
        'apps/api/**/*.{spec,test}.ts',
        'apps/api/integration/**/*.ts',
        'apps/api/src/testing/**/*.ts',
      ],
      excludedFiles: ['apps/api/src/testing/loopback-http-app.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.property.name='getHttpServer']",
            message:
              'Do not hand supertest the Nest server. Bind it with listenHttpApp() from apps/api/src/testing/loopback-http-app.ts and pass request() the URL it returns.',
          },
          {
            selector:
              "CallExpression[callee.name='request'] > Identifier.arguments[name='app']",
            message:
              'Do not hand supertest an app. Bind it with listenHttpApp() or listenHttpHandler() from apps/api/src/testing/loopback-http-app.ts and pass request() the URL.',
          },
        ],
      },
    },
    {
      // apps/api/tsconfig.build.json excludes apps/api/src/testing from the build's input
      // files, so no helper there is compiled on its own. The exclusion does not stop tsc
      // from following an import: a production module importing a helper would pull it,
      // and its test-only dependencies such as supertest, into dist. This rule keeps
      // production modules from importing those helpers, so dist holds none of them.
      files: ['apps/api/src/**/*.ts'],
      excludedFiles: ['apps/api/src/**/*.{spec,test}.ts', 'apps/api/src/testing/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/testing/*', '!@couture/testing', '!@couture/testing/*'],
                message:
                  'apps/api/src/testing holds test helpers that the production build leaves out; import them only from specs and integration suites so none is compiled into dist.',
              },
            ],
          },
        ],
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
      files: [
        'apps/mobile/**/*.{ts,tsx}',
        // These two ship into the Hermes bundle, so the constraint is theirs as much as
        // the app's. The Segmenter incident was in api-client, not apps/mobile, so a
        // guard scoped to the app alone would not have caught the bug it cites.
        'packages/api-client/src/**/*.ts',
        'packages/utils/src/**/*.ts',
      ],
      // Specs may construct the real API to compute an expected value; they run in Node
      // or Chromium, never in Hermes.
      excludedFiles: ['**/*.{spec,test}.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "NewExpression[callee.object.name='Intl'][callee.property.name=/^(ListFormat|Segmenter)$/]",
            message:
              'Hermes ships no Intl.ListFormat or Intl.Segmenter. Use formatLocalizedList from @couture/utils, or feature-detect before constructing.',
          },
          {
            // Hermes has no DOMException global; constructing one throws a ReferenceError
            // and once blanked the community feed in CI Maestro.
            selector: "NewExpression[callee.name='DOMException']",
            message:
              'Hermes has no DOMException. Use abortError() from @couture/api-client and check error.name.',
          },
          {
            // Metro turns import('react-native') into a wildcard interop that evaluates
            // every lazy getter, including deprecated PushNotificationIOS, whose null
            // native module throws on iOS and silently stopped session restore and push.
            selector: "ImportExpression[source.value='react-native']",
            message:
              "Import from 'react-native' statically by name; a dynamic import evaluates every deprecated module getter on iOS.",
          },
        ],
      },
    },
  ],
}
