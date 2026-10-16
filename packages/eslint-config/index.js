module.exports = {
  env: {
    es2021: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },
  plugins: ['@typescript-eslint', 'filenames', 'implicit-dependencies', 'no-only-tests'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:@typescript-eslint/stylistic',
    'plugin:import/typescript',
    'plugin:import/recommended',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: ['dist', 'build', 'node_modules', '.turbo', 'coverage', '**/*.d.ts'],
  rules: {
    // Both rules autofix imports, so they must agree on one style. Without
    // `prefer-inline`, import/no-duplicates merged a module's value import into
    // its `import type` statement, which turns the values type-only: TypeScript
    // rejects it and Metro refuses to bundle (#149). Inline `type` specifiers on
    // the value import are the one form both rules accept.
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { fixStyle: 'inline-type-imports' },
    ],
    'import/no-duplicates': ['error', { 'prefer-inline': true }],
    '@typescript-eslint/consistent-type-exports': 'error',
    '@typescript-eslint/consistent-type-definitions': 'off',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-only-tests/no-only-tests': 'error',
    'filenames/match-regex': ['error', '^[a-z0-9-._\\[\\]]+$', true],
    complexity: ['warn', 15],
    'object-curly-spacing': ['error', 'always'],
    'linebreak-style': ['error', 'unix'],
    // avoidEscape matches Prettier, which prefers double quotes for strings containing an apostrophe
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'never'],
    'import/default': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    'no-empty-pattern': 'off',
    'import/no-named-as-default': 'off',
  },
}
