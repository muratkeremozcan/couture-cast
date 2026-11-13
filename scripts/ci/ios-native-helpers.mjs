// Story 6.15 C-13 and IOS-03: what the iOS workflows call.
//
//   helperProblems  every script, local action, reusable workflow and npm script the workflows
//                   call exists at this commit: an `npm run` resolves against the package.json of
//                   its workspace or working directory, and the scripts it runs in turn, and a
//                   local action's own steps and nested actions count.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

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
