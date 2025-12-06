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
