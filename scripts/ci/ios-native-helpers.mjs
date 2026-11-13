// Story 6.15 C-13, SL-11 and IOS-03: what the iOS workflows call and read.
//
//   helperProblems         every script, local action, reusable workflow and npm script the
//                          workflows call exists at this commit: an `npm run` resolves against the
//                          package.json of its workspace or working directory, and the scripts it
//                          runs in turn, and a local action's own steps and nested actions count.
//   scriptReads            every file under scripts/ the iOS jobs run or read, through imports
//                          and named paths.
//   inputCoverageProblems  the push paths of ios-native.yml cover what scriptReads finds, and name
//                          no scripts/lib file it does not.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { matchesAny } from './lanes.mjs'

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
const listDirectory = (directory) => {
  try {
    return fs.readdirSync(directory)
  } catch {
    return []
  }
}
const DEFAULT_FS = {
  read: readText,
  exists: (file) => fs.existsSync(file),
  list: listDirectory,
}
const LOCAL_ACTION = /^\.\/(\.github\/actions\/[\w.-]+)$/
const REUSABLE = /^\.\/(\.github\/workflows\/[\w.-]+\.ya?ml)$/
const isTest = (file) => /\.test\.[cm]?js$/.test(file)

/** The script paths a shell text names, resolved against its directory and its action's. */
function scriptPaths(text, directory, actionDirectory) {
  const found = []
  for (const match of String(text).matchAll(
    /(?:^|[\s"'])((?:scripts|\.\/\.github\/actions)\/[\w./-]+?\.(?:mjs|cjs|sh|js))(?=[\s"']|$)/gm
  ))
    found.push(path.posix.normalize(path.posix.join(directory, match[1])))
  if (actionDirectory)
    for (const match of String(text).matchAll(
      /\$\{\{\s*github\.action_path\s*\}\}\/([\w./-]+?\.(?:mjs|cjs|sh|js))(?=[\s"']|$)/g
    ))
      found.push(path.posix.normalize(path.posix.join(actionDirectory, match[1])))
  return found
}

/** Each `npm run <name>` or `npm test` in a shell text, with its workspace and flags. */
export function npmCalls(text) {
  const calls = []
  for (const segment of String(text).split(/\n|&&|\|\||;|\|/)) {
    const match = /(?:^|\s)npm\s+(run(?:-script)?|test|t)\b(.*)$/.exec(segment)
    if (!match) continue
    const tokens = match[2].trim().split(/\s+/).filter(Boolean)
    const call = { name: match[1].startsWith('run') ? null : 'test', workspace: null }
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (token === '--') break
      if (token === '--workspace' || token === '-w') call.workspace = tokens[++index]
      else if (token.startsWith('--workspace=')) call.workspace = token.slice(12)
      else if (token === '--if-present') call.ifPresent = true
      else if (token === '--workspaces' || token === '-ws') call.allWorkspaces = true
      else if (!token.startsWith('-') && call.name === null) call.name = token
    }
    if (call.name) calls.push(call)
  }
  return calls
}

/** The directory of a workspace named by path or by package name; null when none matches. */
function workspaceDirectory(workspace, { read, exists, list }) {
  const direct = workspace.replace(/\/$/, '')
  if (exists(`${direct}/package.json`)) return direct
  const root = JSON.parse(read('package.json') ?? '{}')
  for (const glob of [root.workspaces ?? []].flat()) {
    const parent = glob.replace(/\/\*$/, '')
    for (const entry of glob.endsWith('/*') ? list(parent) : [''])
      for (const directory of [entry ? `${parent}/${entry}` : parent]) {
        const manifest = read(`${directory}/package.json`)
        if (manifest && JSON.parse(manifest).name === workspace) return directory
      }
  }
  return null
}

/**
 * IOS-03 and C-13: every helper the workflows call exists. `workflows` maps a file name to its
 * parsed workflow; `files` replaces the file system for tests.
 */
export function helperProblems(workflows, files = DEFAULT_FS) {
  const { read, exists } = { ...DEFAULT_FS, ...files }
  const options = { ...DEFAULT_FS, ...files }
  const problems = []
  const actions = new Set()
  const scripts = new Set()

  const npmScript = (call, directory, where) => {
    if (call.allWorkspaces) return
    const home = call.workspace ? workspaceDirectory(call.workspace, options) : directory
    if (home === null) {
      problems.push(`${where}: npm workspace ${call.workspace} does not exist`)
      return
    }
    const manifest = home === '.' ? 'package.json' : `${home}/package.json`
    const body = JSON.parse(read(manifest) ?? '{}').scripts?.[call.name]
    if (body === undefined) {
      if (!call.ifPresent)
        problems.push(`${where}: npm run ${call.name} is not a script in ${manifest}`)
      return
    }
    if (scripts.has(`${manifest}:${call.name}`)) return
    scripts.add(`${manifest}:${call.name}`)
    shell(body, home, `${manifest} script ${call.name}`)
  }
  const shell = (text, directory, where, actionDirectory) => {
    for (const file of scriptPaths(text, directory, actionDirectory))
      if (!exists(file)) problems.push(`${where}: missing helper ${file}`)
    for (const call of npmCalls(text)) npmScript(call, directory, where)
  }
  const action = (uses, where) => {
    const local = LOCAL_ACTION.exec(String(uses ?? '').trim())
    if (!local) return
    const file = `${local[1]}/action.yml`
    if (actions.has(file)) return
    actions.add(file)
    const text = read(file)
    if (text === null) {
      problems.push(`${where}: missing local action ${file}`)
      return
    }
    for (const step of parse(text)?.runs?.steps ?? []) {
      if (step.run) shell(step.run, step['working-directory'] ?? '.', file, local[1])
      action(step.uses, file)
    }
  }
  for (const [file, workflow] of Object.entries(workflows))
    for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
      const where = `${file} ${name}`
      const reusable = REUSABLE.exec(String(job?.uses ?? ''))
      if (reusable && !exists(reusable[1]))
        problems.push(`${where}: missing reusable workflow ${reusable[1]}`)
      const directory = job?.defaults?.run?.['working-directory'] ?? '.'
      for (const step of job?.steps ?? []) {
        if (step.run) shell(step.run, step['working-directory'] ?? directory, where)
        action(step.uses, where)
      }
    }
  return problems
}

/** The repository files a script text names: relative imports, `scripts/` paths, sibling names. */
function namedScripts(text, directory, exists) {
  const found = []
  for (const match of text.matchAll(
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g
  ))
    found.push(path.posix.normalize(path.posix.join(directory, match[1])))
  for (const match of text.matchAll(
    /(?:^|[\s"'`(=])(scripts\/[\w./-]+?\.(?:mjs|cjs|js|sh|json))(?=[\s"'`),;]|$)/gm
  ))
    found.push(match[1])
  // A script that joins its own directory with a file name, such as path.join(dir, 'run.mjs').
  for (const match of text.matchAll(/['"`]([\w.-]+\.(?:mjs|cjs|sh))['"`]/g)) {
    const sibling = path.posix.join(directory, match[1])
    if (directory !== '.' && exists(sibling)) found.push(sibling)
  }
  return found
}

/**
 * Every file under scripts/ that the iOS jobs run or read: the scripts their steps and local
 * actions name, and everything those import, require or name in turn. Test files are left out
 * and not followed: node-test-gate runs them on pull requests as well.
 * @param {object} workflow the parsed ios-native-jobs.yml
 */
export function scriptReads(workflow, files = DEFAULT_FS) {
  const { read, exists } = { ...DEFAULT_FS, ...files }
  const texts = []
  const actions = new Set()
  const useAction = (uses) => {
    const local = LOCAL_ACTION.exec(String(uses ?? '').trim())
    if (!local || actions.has(local[1])) return
    actions.add(local[1])
    const text = read(`${local[1]}/action.yml`) ?? ''
    texts.push(text)
    for (const nested of text.matchAll(/uses: (\.\/\.github\/actions\/[\w.-]+)/g))
      useAction(nested[1])
  }
  for (const job of Object.values(workflow.jobs ?? {}))
    for (const step of job?.steps ?? []) {
      texts.push(String(step.run ?? ''))
      useAction(step.uses)
    }
  const seen = new Set()
  const stack = texts.flatMap((text) => namedScripts(text, '.', exists))
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file) || isTest(file) || !exists(file)) continue
    seen.add(file)
    // A JSON file is data: the paths it lists are not files the jobs run.
    if (!file.endsWith('.json'))
      stack.push(...namedScripts(read(file) ?? '', path.posix.dirname(file), exists))
  }
  return [...seen].filter((file) => file.startsWith('scripts/')).sort()
}

/**
 * SL-11: the push paths, which are the native iOS inputs, cover every script the iOS jobs run or
 * read, and name no scripts/lib file they do not.
 * @param {object} workflow the parsed ios-native.yml
 * @param {{ reads: string[], libraryFiles: string[] }} files what scriptReads found, and every
 *   file under scripts/lib
 */
export function inputCoverageProblems(workflow, { reads, libraryFiles }) {
  const inputs = workflow.on?.push?.paths ?? []
  const read = new Set(reads)
  const uncovered = reads.filter((file) => !matchesAny(file, inputs))
  const unread = libraryFiles.filter(
    (file) =>
      !/\.(test\.mjs|d\.mts)$/.test(file) && matchesAny(file, inputs) && !read.has(file)
  )
  return [
    ...uncovered.map((file) => `the push paths miss ${file}, which the iOS jobs read`),
    ...unread.map((file) => `the push paths name ${file}, which no iOS job reads`),
  ]
}
