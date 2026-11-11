// Finds apt calls CI makes outside scripts/ci/apt-retry.mjs. Used by apt-retry.test.mjs.
//
// It reads every `run` block of every workflow and composite action under .github, splits it into
// shell commands (comments dropped; `&&`, `||`, `;`, `|` and `&` separate commands), and follows
// what those commands run inside the repository: shell scripts, Node scripts and npm scripts of
// the root or a workspace, with their pre and post scripts, recursively. A shell command counts as
// wrapped only when it starts with the wrapper; everything the wrapper runs is covered by it. A
// Node script that issues apt calls itself must be in INSTALLERS, with the reason it is covered.
import path from 'node:path'
import { parse } from 'yaml'

export const WRAPPER = 'scripts/ci/apt-retry.mjs'

/** apt itself, dpkg installs, and Playwright's installers that run apt for their system packages. */
const SHELL_APT =
  /(?:^|\s)(?:sudo\s+(?:-\S+\s+)*)?(?:apt|apt-get)\s|\bdpkg\s+-i\b|--with-deps\b|\binstall-deps\b/
/** The same calls as a Node script spells them: as an argument or a command string. */
const SCRIPT_APT =
  /['"`](?:sudo\s+)?(?:apt|apt-get)(?:['"`]|\s)|['"`]dpkg['"`]|['"`]--with-deps['"`]|['"`][^'"`]*\binstall-deps\b/

/** Node scripts that run apt themselves, and why that is covered. */
export const INSTALLERS = {
  'scripts/ci/apt-retry.mjs': 'the wrapper',
  'scripts/ci/share-card-browser-deps.mjs':
    'installs through withAptRetries after configureAptRetries (apt-retry.test.mjs checks both)',
}

const SCRIPT_FILE =
  /(?:^|[\s=])(?:\.\/)?((?:scripts|apps|packages|playwright|tools|\.github)\/[\w./@-]+\.(?:sh|bash|mjs|cjs|js|ts))\b/g

/** Every `run` block of every step in a workflow or composite action. */
function runBlocks(document) {
  const blocks = []
  for (const job of Object.values(document?.jobs ?? {}))
    for (const step of job?.steps ?? [])
      if (typeof step?.run === 'string') blocks.push(step.run)
  for (const step of document?.runs?.steps ?? [])
    if (typeof step?.run === 'string') blocks.push(step.run)
  return blocks
}

/** Drops a `#` comment that is not inside quotes. */
function withoutComment(line) {
  let quote = ''
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === "'" || character === '"') quote = character
    else if (character === '#' && (index === 0 || /\s/.test(line[index - 1])))
      return line.slice(0, index)
  }
  return line
}

/** The shell commands of a script, one per element, whitespace collapsed. */
export function shellCommands(text) {
  return text
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map(withoutComment)
    .flatMap((line) => line.split(/&&|\|\||;|\||&(?!>)/))
    .map((command) => command.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

const wrapped = (command) =>
  /^(?:\w+=\S*\s+)*node\s+(?:\.\/)?scripts\/ci\/apt-retry\.mjs(?:\s|$)/.test(command)

/** `npm run <name>` with an optional workspace, in either order. */
function npmScriptOf(command) {
  const tokens = command.split(' ')
  const npm = tokens.indexOf('npm')
  if (npm < 0) return undefined
  const rest = tokens.slice(npm + 1)
  let workspace
  let name
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === '--workspace' || token === '-w') workspace = rest[++index]
    else if (token.startsWith('--workspace=')) workspace = token.slice(12)
    else if ((token === 'run' || token === 'run-script') && !name) name = rest[++index]
    else if (token === '--') break
  }
  return name ? { name, workspace } : undefined
}

/**
 * Each apt call CI reaches outside the wrapper, as `where: command` (`unwrapped`), and every
 * repository script and npm script the walk reached (`reached`), so a test can tell a clean
 * result from a walk that never got anywhere.
 *
 * @param {{ files: string[], read: (file: string) => string, exists: (file: string) => boolean }} repo
 */
export function unwrappedAptCalls({ files, read, exists }) {
  const found = []
  const visited = new Set()
  const workspaces = new Map()
  const packageJson = (directory) => {
    const file = path.posix.join(directory, 'package.json')
    return exists(file) ? JSON.parse(read(file)) : undefined
  }
  const rootPackage = packageJson('.') ?? {}
  for (const pattern of rootPackage.workspaces ?? []) {
    const prefix = pattern.replace(/\/\*$/, '')
    for (const file of files.filter((candidate) =>
      candidate.match(new RegExp(`^${prefix}/[^/]+/package\\.json$`))
    )) {
      const directory = path.posix.dirname(file)
      const manifest = JSON.parse(read(file))
      workspaces.set(directory, manifest)
      if (manifest.name) workspaces.set(manifest.name, manifest)
      workspaces.set(path.posix.basename(directory), manifest)
    }
  }

  const visitScript = (file, from) => {
    if (visited.has(file) || !exists(file)) return
    visited.add(file)
    const text = read(file)
    if (/\.(?:sh|bash)$/.test(file)) visitShell(text, file)
    else {
      if (SCRIPT_APT.test(text) && !(file in INSTALLERS))
        found.push(`${file} (run from ${from}): issues apt calls itself`)
      for (const [, child] of text.matchAll(SCRIPT_FILE)) visitScript(child, file)
    }
  }

  const visitNpm = ({ name, workspace }, from) => {
    const manifest = workspace ? workspaces.get(workspace) : rootPackage
    const scripts = manifest?.scripts ?? {}
    for (const script of [`pre${name}`, name, `post${name}`]) {
      const body = scripts[script]
      const key = `npm:${workspace ?? '.'}:${script}`
      if (body === undefined || visited.has(key)) continue
      visited.add(key)
      visitShell(
        body,
        `${from} > npm run ${script}${workspace ? ` -w ${workspace}` : ''}`
      )
    }
  }

  const visitShell = (text, where) => {
    for (const command of shellCommands(text)) {
      if (wrapped(command)) continue
      if (SHELL_APT.test(command)) found.push(`${where}: ${command}`)
      for (const [, file] of command.matchAll(SCRIPT_FILE)) visitScript(file, where)
      const npm = npmScriptOf(command)
      if (npm) visitNpm(npm, where)
    }
  }

  for (const file of files.filter((candidate) => /^\.github\/.*\.ya?ml$/.test(candidate)))
    for (const block of runBlocks(parse(read(file)))) visitShell(block, file)
  return { unwrapped: found, reached: [...visited] }
}
