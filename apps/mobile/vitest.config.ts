import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright' // eslint-disable-line import/no-unresolved

const isWatchMode = !process.argv.includes('run') && !process.argv.includes('--run')

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    loader: 'tsx',
    include: [/\.[jt]sx?$/, /node_modules\/expo-router\/.*\.js$/],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'vitest-browser-react'],
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  resolve: {
    alias: [
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
        find: /^react-native$/,
        replacement: path.resolve(
          __dirname,
          './src/test-utils/mocks/react-native-proxy.js'
        ),
      },
      {
        find: /^react$/,
        replacement: path.resolve(__dirname, '../../node_modules/react'),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(__dirname, '../../node_modules/react-dom'),
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
