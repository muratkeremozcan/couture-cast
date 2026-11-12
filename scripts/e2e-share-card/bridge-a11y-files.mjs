// The app test files bridge-a11y.mjs runs, from apps/mobile. The share-card workflow's
// main-push path filter keeps each of them as an input (scripts/ci/share-card-paths.test.mjs).
export const BRIDGE_APP_DIR = 'apps/mobile'
export const BRIDGE_UNIT_FILES = [
  'components/share-card-composer.test.tsx',
  'src/lib/share-card-focus.spec.ts',
]
