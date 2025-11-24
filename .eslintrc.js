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
          './apps/mobile/tsconfig.json',
          './apps/web/tsconfig.json',
          './apps/api/tsconfig.json',
          './playwright/tsconfig.json',
        ],
      },
    },
  },
}
