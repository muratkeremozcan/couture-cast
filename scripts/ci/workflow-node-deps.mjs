// A workflow step that runs a repository Node script before its job installs dependencies can only
// load Node's built-in modules and the repository's own files. A package import there fails with
// ERR_MODULE_NOT_FOUND on the runner while every local run passes, because a laptop always has
// node_modules: d2178e15 (yaml in a coverage merge job) and the a5aaf9b6 coverage merge job both
// went red this way. This module finds every such script and every package it would fail to load.
//
// What counts as the install: a step using one of the repository's install actions, or an
// unconditional root `npm ci` / `npm install` / scripts/ci/install-dependencies.sh. A node_modules
// cache restore does not count: it can miss, and on a miss nothing is there.
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import { parse } from 'yaml'

const builtins = new Set(builtinModules)

/** The repository's install actions: each leaves node_modules in place, by restore or install. */
export const INSTALL_ACTIONS = [
  './.github/actions/install',
  './.github/actions/node-dependencies',
  './.github/actions/setup-node-env',
]

/**
 * Scripts allowed to load packages before the install, each with why that cannot fail a job.
 * verify-dependency-tree.mjs probes a restored tree inside try/catch, and its caller installs when
 * it exits nonzero.
 */
export const RUNTIME_PROBES = {
  'scripts/ci/verify-dependency-tree.mjs':
    'probes a restored node_modules in try/catch; node-dependencies installs when it exits nonzero',
}

// ---------------------------------------------------------------------------------------------
// JavaScript: the module specifiers a file loads, read from its syntax tree (TypeScript's parser,
// a root devDependency), so strings, templates, comments and regexes never read as loads.

const literal = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null

/** The names a file binds to the createRequire function itself: imported, destructured or read. */
function createRequireNames(file) {
  const names = new Set(['createRequire'])
  const visit = (node) => {
    // import { createRequire as cr } from 'node:module'
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName ?? node.name).text === 'createRequire'
    )
      names.add(node.name.text)
    // const { createRequire: cr } = module
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      (node.propertyName && ts.isIdentifier(node.propertyName)
        ? node.propertyName.text
        : node.name.text) === 'createRequire'
    )
      names.add(node.name.text)
    // const cr = module.createRequire
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === 'createRequire'
    )
      names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

/** Whether `node` calls createRequire: by any name bound to it, or through a namespace. */
const isCreateRequire = (node, factories) =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && factories.has(node.expression.text)) ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'createRequire'))

/** The names bound to a createRequire result, by declaration or by assignment. */
function requireNames(file, factories) {
  const names = new Set(['require'])
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateRequire(node.initializer, factories)
    )
      names.add(node.name.text)
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isCreateRequire(node.right, factories)
    )
      names.add(node.left.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

/** Whether a call's callee loads its first argument: require, a createRequire result, or one's .resolve. */
function loaderCallee(callee, names, factories) {
  const base =
    ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve'
      ? callee.expression
      : callee
  if (ts.isIdentifier(base)) return names.has(base.text)
  if (isCreateRequire(base, factories)) return true
  // import.meta.resolve('x')
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'resolve' &&
    ts.isMetaProperty(callee.expression)
  )
}

/** Every module specifier a source loads: import, export-from, import(), require, createRequire. */
export function specifiers(source) {
  const file = ts.createSourceFile(
    'x.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const factories = createRequireNames(file)
  const names = requireNames(file, factories)
  const found = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      found.push(literal(node.moduleSpecifier))
    else if (ts.isCallExpression(node)) {
      const first = literal(node.arguments[0])
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push(first)
      else if (loaderCallee(node.expression, names, factories)) found.push(first)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found.filter((specifier) => typeof specifier === 'string')
}

const allowed = (specifier) =>
  specifier.startsWith('node:') ||
  specifier.startsWith('./') ||
  specifier.startsWith('../') ||
  specifier.startsWith('/') ||
  builtins.has(specifier)

const scriptExtension = /\.(m?js|cjs)$/

function resolveRelative(from, specifier) {
  const target = path.resolve(path.dirname(from), specifier)
  const candidates = [
    target,
    ...['.mjs', '.js', '.cjs'].map((ext) => `${target}${ext}`),
    ...['index.mjs', 'index.js', 'index.cjs'].map((name) => path.join(target, name)),
  ]
  return (
    candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null
  )
}

/** Each package a script, or a repository file it loads, would need: `{ file, specifier }`. */
export function packageImports(entry, { root, exempt = RUNTIME_PROBES } = {}) {
  const problems = []
  const seen = new Set()
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const skipPackages =
      root !== undefined && Object.hasOwn(exempt, path.relative(root, file))
    for (const specifier of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (!allowed(specifier)) {
        if (!skipPackages) problems.push({ file, specifier })
      } else if (!specifier.startsWith('node:') && !builtins.has(specifier)) {
        const next = resolveRelative(file, specifier)
        if (next && scriptExtension.test(next)) visit(next)
      }
    }
  }
  visit(entry)
  return problems
}

// ---------------------------------------------------------------------------------------------
// Shell: the node commands a run block executes, through npm run and repository shell scripts.

/**
 * Shell words of one command, quotes removed. A word with an expansion is `null`, unless `raw`
 * asks for its literal text (node -e code, where a `$` belongs to the script).
 */
function words(command, { raw = false } = {}) {
  const out = []
  let word = ''
  let started = false
  let dynamic = false
  const flush = () => {
    if (started) out.push(dynamic && !raw ? null : word)
    word = ''
    started = false
    dynamic = false
  }
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]
    if (/\s/.test(c)) flush()
    else if (c === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end < 0 ? command.length : end
      word += command.slice(i + 1, stop)
      started = true
      i = stop
    } else if (c === '"') {
      let j = i + 1
      while (j < command.length && command[j] !== '"') j += command[j] === '\\' ? 2 : 1
      const body = command.slice(i + 1, j)
      if (/[$`]/.test(body)) dynamic = true
      word += body.replace(/\\([`$"\\])/g, '$1')
      started = true
      i = j
    } else {
      if (c === '$' || c === '`') dynamic = true
      word += c
      started = true
    }
  }
  flush()
  return out
}

/** The commands of a shell block: split on newlines, ;, &, |, ( and ) outside quotes. */
function commands(script) {
  const text = script.replace(/\\\n/g, ' ')
  const out = []
  let current = ''
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') {
        current += c + (text[i + 1] ?? '')
        i += 1
        continue
      }
      current += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      continue
    }
    if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end - 1
      continue
    }
    if ('\n;|&()'.includes(c)) {
      out.push(current)
      current = ''
      continue
    }
    current += c
  }
  out.push(current)
  return out
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) =>
      command.replace(/^((then|do|else|elif|if|while|until|!|time|exec)\s+)+/, '')
    )
}

const nodeValueFlags = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '-C',
  '--conditions',
  '--env-file',
  '--env-file-if-exists',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-concurrency',
  '--test-shard',
  '--test-timeout',
  '--watch-path',
  '--input-type',
  '--title',
])
const preloadFlags = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
])
const evalFlags = new Set(['-e', '--eval', '-p', '--print'])
const globChars = /[*?[]/

function expand(root, cwd, pattern) {
  const absolute = path.resolve(root, cwd, pattern)
  if (!globChars.test(pattern)) return fs.existsSync(absolute) ? [absolute] : []
  const dir = path.dirname(absolute)
  const base = path.basename(absolute)
  if (globChars.test(path.relative(root, dir)) || !fs.existsSync(dir)) return []
  const regex = new RegExp(
    `^${base
      .replace(/[.+^${}()|\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`
  )
  return fs
    .readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => path.join(dir, name))
}

function workspaceDir(root, dir, prefix, workspace) {
  if (prefix) return path.relative(root, path.resolve(root, dir, prefix)) || '.'
  if (!workspace) return dir
  if (fs.existsSync(path.join(root, workspace, 'package.json'))) return workspace
  for (const parent of ['apps', 'packages']) {
    const base = path.join(root, parent)
    if (!fs.existsSync(base)) continue
    for (const name of fs.readdirSync(base)) {
      const manifest = path.join(base, name, 'package.json')
      if (
        fs.existsSync(manifest) &&
        JSON.parse(fs.readFileSync(manifest, 'utf8')).name === workspace
      )
        return path.join(parent, name)
    }
  }
  return null
}

/** A flag's name and its `=value`, if any. */
const splitFlag = (arg) => (arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg, undefined])

/** What a preload flag's value adds: a repository file, or a package named directly. */
function addPreload(root, dir, value, loads) {
  if (typeof value !== 'string') return
  if (allowed(value)) expand(root, dir, value).forEach((file) => loads.scripts.add(file))
  else loads.inline.push(value)
}

/** The scripts and packages one `node ...` command loads, into `loads`. */
function nodeCommand(root, dir, args, loads, rawArgs = args) {
  let testMode = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === null || arg === '--test') {
      testMode ||= arg === '--test'
      continue
    }
    const [flag, inlineValue] = splitFlag(arg)
    if (evalFlags.has(flag)) {
      const code = splitFlag(rawArgs[i] ?? '')[1] ?? rawArgs[i + 1]
      if (typeof code === 'string')
        loads.inline.push(...specifiers(code).filter((s) => !allowed(s)))
      return
    }
    if (nodeValueFlags.has(flag)) {
      const value = inlineValue ?? args[++i]
      if (preloadFlags.has(flag)) addPreload(root, dir, value, loads)
      continue
    }
    if (arg.startsWith('-')) continue
    // The script: any repository file, with or without an extension, or a node --test glob.
    expand(root, dir, arg)
      .filter((file) => fs.statSync(file).isFile())
      .forEach((file) => loads.scripts.add(file))
    if (!testMode) return
  }
}

/** The package directory and script name an `npm run`, `npm run-script` or `npm test` executes. */
function npmScript(root, dir, args) {
  let prefix
  let workspace
  const rest = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--prefix') prefix = args[++i]
    else if (arg === '-w' || arg === '--workspace') workspace = args[++i]
    else if (arg.startsWith('--prefix=')) prefix = arg.slice(9)
    else if (arg.startsWith('--workspace=')) workspace = arg.slice(12)
    else rest.push(arg)
  }
  const [verb, name] = rest
  const scriptName = ['test', 't'].includes(verb)
    ? 'test'
    : ['run', 'run-script'].includes(verb)
      ? name
      : null
  const packageDir =
    typeof scriptName === 'string' && workspaceDir(root, dir, prefix, workspace)
  const manifest = packageDir && path.join(root, packageDir, 'package.json')
  if (!manifest || !fs.existsSync(manifest)) return null
  const body = JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts?.[scriptName]
  return typeof body === 'string' ? { packageDir, body } : null
}

/** The repository shell script a `bash` or `sh` command runs, or null. */
function shellScript(root, dir, args) {
  const target = args.find((arg) => typeof arg === 'string' && !arg.startsWith('-'))
  const file = target && path.resolve(root, dir, target)
  return file && file.startsWith(root) && fs.existsSync(file) ? file : null
}

/** A command's program and arguments, after `env` and leading variable assignments. */
function programOf(command, options) {
  let argv = words(command, options)
  if (argv[0] === 'env') argv = argv.slice(1)
  while (argv.length && typeof argv[0] === 'string' && /^[A-Za-z_]\w*=/.test(argv[0]))
    argv = argv.slice(1)
  return argv
}

/**
 * The delimiter after `<<` or `<<-` at `j`, unquoted as the shell unquotes it: a backslash keeps
 * the next character, and quoted parts join the word (`\\EOF`, `'E'OF` and `"EOF"` are all EOF).
 */
function delimiterAt(command, j) {
  const strip = command[j] === '-'
  let k = strip ? j + 1 : j
  while (command[k] === ' ' || command[k] === '\t') k += 1
  let word = ''
  for (; k < command.length && !/[\s<>|&;()]/.test(command[k]); k += 1) {
    const c = command[k]
    if (c === '\\') word += command[++k] ?? ''
    else if (c === "'" || c === '"') {
      const close = command.indexOf(c, k + 1)
      const end = close < 0 ? command.length : close
      word += command.slice(k + 1, end)
      k = end
    } else word += c
  }
  return word ? { strip, word } : null
}

/**
 * The heredoc a command opens, if any: `{ strip, word }` for an unquoted `<<` or `<<-` (not the
 * `<<<` here-string), with its delimiter word, quoted or bare, read as the shell reads it.
 */
function heredocMarker(command) {
  let quote = ''
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]
    if (quote) quote = c === quote ? '' : quote
    else if (c === "'" || c === '"') quote = c
    else if (
      command.startsWith('<<', i) &&
      command[i + 2] !== '<' &&
      command[i - 1] !== '<'
    )
      return delimiterAt(command, i + 2)
  }
  return null
}

/**
 * The run block with each heredoc body taken out, so its lines never read as commands, and the
 * bodies fed to a `node` command (its program on stdin) returned as code. A `<<` inside a comment
 * or a quoted string opens nothing.
 */
function heredocs(run) {
  const lines = run.split('\n')
  const kept = []
  const nodeCode = []
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i]
    kept.push(header)
    let from = 0
    const opened = commands(header)
      .map((command) => {
        from = header.indexOf(command, from) + command.length
        return { command, end: from, marker: heredocMarker(command) }
      })
      .find(({ marker }) => marker)
    if (!opened) continue
    const body = []
    while (i + 1 < lines.length) {
      i += 1
      const line = opened.marker.strip ? lines[i].replace(/^\t+/, '') : lines[i]
      if (line === opened.marker.word) break
      body.push(line)
    }
    const [program] = programOf(opened.command)
    if (program === 'node') {
      // The node command gets a marker word right after its own text (before a trailing comment
      // or a pipe), so its code is read where the command runs, after any cd before it.
      const mark = ` ${STDIN_MARK}${nodeCode.length}`
      kept[kept.length - 1] =
        header.slice(0, opened.end) + mark + header.slice(opened.end)
      nodeCode.push(body.join('\n'))
    }
  }
  return { text: kept.join('\n'), nodeCode }
}

const STDIN_MARK = '@@node-stdin:'

/** Code fed to node on stdin: its packages, and the relative files it loads from `cwd`. */
function stdinLoads(root, cwd, code, loads) {
  for (const specifier of specifiers(code)) {
    if (!allowed(specifier)) loads.inline.push(specifier)
    else if (specifier.startsWith('.')) {
      const file = resolveRelative(path.join(root, cwd, 'stdin.mjs'), specifier)
      if (file) loads.scripts.add(file)
    }
  }
}

/**
 * What a run block makes Node load: `{ scripts, inline }`. Scripts are repository files (each
 * `node` script, every `node --test` file, a relative preload); inline holds package specifiers
 * named directly (a package preload, or a load inside `node -e` code). `cd`, `npm run`, `npm test`
 * and repository shell scripts run with bash or sh are followed.
 */
export function nodeLoads(root, run, cwd = '.', depth = 0) {
  const loads = { scripts: new Set(), inline: [] }
  const follow = (body, at) => {
    const nested = nodeLoads(root, body, at, depth + 1)
    nested.scripts.forEach((file) => loads.scripts.add(file))
    loads.inline.push(...nested.inline)
  }
  let dir = cwd
  const { text, nodeCode } = heredocs(run)
  for (const command of commands(text)) {
    const [program, ...args] = programOf(command)
    if (program === 'cd' && typeof args[0] === 'string')
      dir = path.relative(root, path.resolve(root, dir, args[0])) || '.'
    else if (program === 'node') {
      const marked = (arg) => typeof arg === 'string' && arg.startsWith(STDIN_MARK)
      const stdin = args.find(marked)
      if (stdin)
        stdinLoads(root, dir, nodeCode[Number(stdin.slice(STDIN_MARK.length))], loads)
      // Flags still apply to stdin code: node -r yaml <<'EOF' preloads yaml.
      const unmarked = (list) => list.filter((arg) => !marked(arg))
      nodeCommand(
        root,
        dir,
        unmarked(args),
        loads,
        unmarked(programOf(command, { raw: true }).slice(1))
      )
    } else if (depth >= 5) continue
    else if (program === 'bash' || program === 'sh') {
      const file = shellScript(root, dir, args)
      if (file) follow(fs.readFileSync(file, 'utf8'), dir)
    } else if (program === 'npm') {
      const script = npmScript(root, dir, args)
      if (script) follow(script.body, script.packageDir)
    }
  }
  return { scripts: [...loads.scripts], inline: loads.inline }
}

// ---------------------------------------------------------------------------------------------
// Workflows: each job's steps in order and whether node_modules is in place before each.

const unconditional = (condition) =>
  condition === undefined ||
  /^\s*(\$\{\{\s*)?(always\(\)|success\(\)|!\s*cancelled\(\))\s*(\}\})?\s*$/.test(
    String(condition)
  )
const never = (condition) =>
  condition === false || /^\s*(\$\{\{\s*)?false\s*(\}\})?\s*$/.test(String(condition))

/** Whether a run block installs the root dependency tree (not a workspace or a global tool). */
function installsRoot(run, cwd) {
  if (cwd !== '.') return false
  return commands(run).some((command) => {
    const argv = words(command).filter((word) => word !== null)
    if (
      (argv[0] === 'bash' || argv[0] === 'sh') &&
      /(^|\/)scripts\/ci\/install-dependencies\.sh$/.test(argv[1] ?? '')
    )
      return true
    if (argv[0] !== 'npm' || !['ci', 'install', 'i'].includes(argv[1])) return false
    return !argv
      .slice(2)
      .some((word) => /^(-g|--global|--prefix|-w|--workspace)(=|$)/.test(word))
  })
}

function localAction(root, uses) {
  if (typeof uses !== 'string' || !uses.startsWith('./')) return null
  const dir = path.join(root, uses)
  for (const name of ['action.yml', 'action.yaml']) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return { dir, action: parse(fs.readFileSync(file, 'utf8')) }
  }
  return null
}

/**
 * The job's steps in run order, local composite actions expanded inline, each with whether
 * node_modules is in place before it and its working directory. A step whose `if` is literally
 * false never runs and is left out; a conditional step never counts as the install.
 */
export function stepsWithInstallState(root, steps, defaultCwd = '.') {
  const out = []
  let installed = false
  const visit = (list, seen) => {
    for (const step of list ?? []) {
      if (never(step.if)) continue
      const composite = localAction(root, step.uses)
      if (composite && !seen.has(composite.dir)) {
        visit(composite.action?.runs?.steps, new Set([...seen, composite.dir]))
        if (
          INSTALL_ACTIONS.includes(step.uses.replace(/\/$/, '')) &&
          unconditional(step.if)
        )
          installed = true
        continue
      }
      const cwd = step['working-directory'] ?? defaultCwd
      out.push({ step, installed, cwd })
      if (
        typeof step.run === 'string' &&
        unconditional(step.if) &&
        installsRoot(step.run, cwd)
      )
        installed = true
    }
  }
  visit(steps, new Set())
  return out
}

/**
 * Every package a workflow job would load before its dependencies are installed:
 * `{ workflow, job, step, script, file, specifier }`.
 */
export function workflowProblems(root, workflowFile) {
  const workflow = parse(fs.readFileSync(workflowFile, 'utf8'))
  const problems = []
  const rel = (file) => path.relative(root, file)
  for (const [job, definition] of Object.entries(workflow?.jobs ?? {})) {
    const defaultCwd =
      definition.defaults?.run?.['working-directory'] ??
      workflow.defaults?.run?.['working-directory'] ??
      '.'
    for (const { step, installed, cwd } of stepsWithInstallState(
      root,
      definition.steps,
      defaultCwd
    )) {
      if (installed || typeof step.run !== 'string') continue
      const name = step.name ?? step.id ?? step.run.split('\n')[0]
      const base = { workflow: rel(workflowFile), job, step: name }
      const loads = nodeLoads(root, step.run, cwd)
      for (const specifier of loads.inline)
        problems.push({ ...base, script: '(inline)', file: '(inline)', specifier })
      for (const script of loads.scripts)
        for (const problem of packageImports(script, { root }))
          problems.push({
            ...base,
            script: rel(script),
            file: rel(problem.file),
            specifier: problem.specifier,
          })
    }
  }
  return problems
}
