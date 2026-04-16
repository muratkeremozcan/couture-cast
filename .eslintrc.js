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
          './playwright/tsconfig.eslint.json',
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
      files: ['playwright/**/*.{ts,tsx}'],
      parserOptions: {
        project: ['./playwright/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
  ],
}
