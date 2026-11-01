import path from 'node:path'

// Type-aware ESLint loads a TypeScript program for every project a file set touches.
// One process across mobile, web and api together runs past the 4 GB heap on a large
// commit (a merge from main, for one), so ESLint runs once per workspace instead,
// the same split `npm run lint` uses.
const ESLINT =
  'eslint --max-warnings=0 --cache --cache-location node_modules/.cache/eslint --fix --no-ignore'
const PRETTIER = 'npm run prettier:ci -- --write'
const BUILD_SHARED =
  'sh -c "npm run build --workspace @couture/utils && npm run build --workspace @couture/api-client"'

const quote = (files) => files.map((file) => JSON.stringify(file)).join(' ')

function workspaceOf(file) {
  const [first, second] = path.relative(process.cwd(), file).split(path.sep)
  return first === 'apps' || first === 'packages' ? `${first}/${second}` : first
}

function eslintPerWorkspace(files) {
  const groups = new Map()
  for (const file of files) {
    const key = workspaceOf(file)
    groups.set(key, [...(groups.get(key) ?? []), file])
  }
  return [...groups.values()].map((group) => `${ESLINT} ${quote(group)}`)
}

export default {
  '*.{ts,tsx}': (files) => [
    BUILD_SHARED,
    ...eslintPerWorkspace(files),
    `${PRETTIER} ${quote(files)}`,
  ],
  '*.{mjs,cjs}': (files) => [...eslintPerWorkspace(files), `${PRETTIER} ${quote(files)}`],
  '*.{json,md}': `${PRETTIER}`,
}
