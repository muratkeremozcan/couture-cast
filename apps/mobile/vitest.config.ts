import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright' // eslint-disable-line import/no-unresolved

const resolveFromMobile = createRequire(path.join(__dirname, 'package.json')).resolve
/** A package's directory, located through its exported package.json. */
const packageDirectory = (name: string) =>
  path.dirname(resolveFromMobile(`${name}/package.json`))

// expo-constants keeps its web module out of its exports map, so it is located from the
// package's own exported package.json; vitest.expo-env.setup.ts registers it.
const expoConstantsWebModule = path.join(
  packageDirectory('expo-constants'),
  'build/ExponentConstants.web.js'
)

const isWatchMode = !process.argv.includes('run') && !process.argv.includes('--run')

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    loader: 'tsx',
    include: [/\.[jt]sx?$/, /node_modules\/expo-router\/.*\.js$/],
  },
  optimizeDeps: {
    // Vite discovers dependencies by crawling the entry document, so a bare
    // import that appears only inside a test file is found late. In browser
    // mode that triggers a re-optimization mid-run, which invalidates modules
    // other workers already loaded and fails them with "does not provide an
    // export named 'default'". That is the exact signature behind the
    // intermittent CI failure in `wardrobe-hub-screen.test.tsx`, and locally,
    // against a cold `node_modules/.vite`, naming `expo-router` here removed
    // ten such failures on its own.
    //
    // This list is deliberately short, and two kinds of package must NEVER
    // join it. `msw` makes esbuild fail outright ("The entry point msw cannot
    // be marked as external") because the resolve alias below swaps `msw/node`
    // for a browser shim. Native-only Expo modules (expo-web-browser,
    // expo-image-picker, expo-crypto) wedge the optimizer entirely: they pull
    // in `expo-modules-core`, which cannot be evaluated in a browser bundle at
    // all. That is why `src/lib/commerce.ts` imports `expo-web-browser`
    // lazily, and force-prebundling it reintroduces exactly the hazard the
    // lazy import exists to avoid.
    //
    // `posthog-react-native` was measured and left out: it neither wedged the
    // optimizer nor changed the cold-run failure count, so it is cost without
    // benefit.
    include: [
      '@testing-library/react',
      '@couture/testing/factories/community.factory',
      'expo-background-fetch',
      // vitest.expo-env.setup.ts installs Expo's web global from this entry. It pulls in
      // only the polyfill classes and the uuid helper, never a native module.
      'expo-modules-core/src/polyfill/dangerous-internal',
      'expo-localization',
      'expo-router',
      'expo-task-manager',
      'i18next',
      'react',
      'react-dom',
      'react-i18next',
      'react/jsx-dev-runtime',
      'vitest-browser-react',
    ],
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^expo-constants\/exponent-constants-web$/,
        replacement: expoConstantsWebModule,
      },
      {
        find: /^msw\/node$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/msw-node-browser-shim.js'
        ),
      },
      {
        find: /^react-native\/Libraries\/ReactNative\/AppContainer$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-libraries.js'
        ),
      },
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeComponent$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-libraries.js'
        ),
      },
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeCommands$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-libraries.js'
        ),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-libraries.js'
        ),
      },
      {
        // Story 5.2: the RevenueCat SDK's native module is absent under vitest
        // exactly as it is under Expo Go, so every import lands on the mock.
        find: /^react-native-purchases$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-purchases.ts'
        ),
      },
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-safe-area-context.jsx'
        ),
      },
      {
        find: /^react-native$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-proxy.js'
        ),
      },
      {
        find: /^react$/,
        // One React for the app, the renderer and the testing libraries; see
        // src/lib/react-single-instance.spec.tsx.
        replacement: packageDirectory('react'),
      },
      {
        find: /^react-dom$/,
        replacement: packageDirectory('react-dom'),
      },
      {
        find: /^@couture\/api-client\/contracts\/http$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/api-client/src/contracts/http/index.ts'
        ),
      },
      {
        find: /^@couture\/api-client\/contracts\/http\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/api-client/src/contracts/http/$1.ts'
        ),
      },
      {
        find: /^@couture\/api-client\/testing\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/api-client/src/testing/$1.ts'
        ),
      },
      {
        find: /^@couture\/api-client$/,
        replacement: path.resolve(__dirname, '../../packages/api-client/src/index.ts'),
      },
      {
        find: /^@couture\/utils$/,
        replacement: path.resolve(__dirname, '../../packages/utils/src/index.ts'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './'),
      },
    ],
  },
  define: {
    __DEV__: JSON.stringify(true),
    'process.env': {},
    __VITEST_WATCH__: JSON.stringify(isWatchMode),
  },
  test: {
    server: {
      deps: {
        inline: [/expo-router/],
      },
    },
    browser: {
      enabled: true,
      instances: [{ browser: 'chromium' }],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      provider: playwright(),
      headless: !isWatchMode,
    },
    setupFiles: ['./vitest.expo-env.setup.ts', './vitest.setup.ts'],
    include: ['components/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 92, branches: 87, functions: 93, lines: 94 },
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      exclude: [
        // Expo Router navigation shells: Stack/Tabs declarations plus font and
        // splash-screen bootstrapping. There is no branch a unit test can
        // assert; the Maestro flows exercise the real navigation graph.
        'app/**/_layout.tsx',
        'app/+html.tsx',
        // MSW handlers and native-module mocks: test scaffolding.
        'src/test-utils/**',
      ],
    },
  },
})
