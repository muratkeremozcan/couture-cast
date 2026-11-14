// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// One React across the monorepo (story 6.15 D3, TEA-14). Web and mobile share the hoisted React,
// so every SDK step moves them together. Returns the problems found; empty means parity holds.
const RUNTIME = ['react', 'react-dom', 'react-test-renderer']
const TYPES = ['@types/react', '@types/react-dom']
const TRACKED = [...RUNTIME, ...TYPES]

const exact = (range) => /^\d+\.\d+\.\d+$/.test(range ?? '')
const majorMinor = (version) => version.split('.').slice(0, 2).join('.')

function collectDeclared(manifests, problems) {
  const declared = new Map(TRACKED.map((name) => [name, new Map()]))
  for (const [workspace, manifest] of Object.entries(manifests)) {
    const all = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const name of TRACKED.filter((tracked) => all[tracked] !== undefined)) {
      if (!exact(all[name]))
        problems.push(`${workspace}: ${name} ${all[name]} is not an exact version`)
      declared.get(name).set(workspace, all[name])
    }
  }
  return declared
}

function alignmentProblems(declared, react) {
  const problems = []
  for (const [name, byWorkspace] of declared) {
    if (new Set(byWorkspace.values()).size > 1)
      problems.push(
        `${name} differs: ${[...byWorkspace].map(([w, v]) => `${w} ${v}`).join(', ')}`
      )
  }
  for (const name of ['react-dom', 'react-test-renderer'])
    for (const [workspace, version] of declared.get(name))
      if (version !== react)
        problems.push(`${workspace}: ${name} ${version} is not react ${react}`)
  for (const name of TYPES)
    for (const [workspace, version] of declared.get(name))
      if (majorMinor(version) !== majorMinor(react))
        problems.push(
          `${workspace}: ${name} ${version} does not match react ${majorMinor(react)}`
        )
  return problems
}

function lockfileProblems(declared, lock) {
  const problems = []
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    const match =
      /(?:^|\/)node_modules\/((?:@types\/)?react(?:-dom|-test-renderer)?)$/.exec(location)
    const expected = match && [...(declared.get(match[1])?.values() ?? [])][0]
    if (expected && entry.version !== expected)
      problems.push(`lockfile ${location} ${entry.version} is not ${expected}`)
  }
  return problems
}

/**
 * @param {{ manifests: Record<string, { dependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string> }>, lock: { packages: Record<string, { version?: string }> } }} input
 */
export function reactParityProblems({ manifests, lock }) {
  const problems = []
  const declared = collectDeclared(manifests, problems)
  const react = [...declared.get('react').values()][0]
  if (!react) return [...problems, 'no workspace declares react']
  return [
    ...problems,
    ...alignmentProblems(declared, react),
    ...lockfileProblems(declared, lock),
  ]
}
