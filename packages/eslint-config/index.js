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
    'plugin:import/typescript',
    'plugin:import/recommended',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: ['dist', 'build', 'node_modules', '.turbo', 'coverage', '**/*.d.ts'],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/consistent-type-exports': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-only-tests/no-only-tests': 'error',
    'filenames/match-regex': ['error', '^[a-z0-9-._\\[\\]]+$', true],
    complexity: ['warn', 15],
    'object-curly-spacing': ['error', 'always'],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single'],
    semi: ['error', 'never'],
    'import/default': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    'no-empty-pattern': 'off',
    'import/no-named-as-default': 'off',
  },
}
