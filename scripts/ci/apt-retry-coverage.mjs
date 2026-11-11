// The reviewed inventory of apt calls in CI. Used by apt-retry.test.mjs.
//
// Every tracked file under .github and scripts, and every package.json script, is searched for
// apt calls: `apt-get`, `apt <verb>`, `dpkg -i`, and Playwright's `--with-deps` and `install-deps`,
// which run apt for their system packages. A hit passes only when its shell command starts with
// `node scripts/ci/apt-retry.mjs` (everything that command runs is covered by the wrapper), or when
// its file is in ALLOWLIST with the reason it is covered. So a new apt line anywhere fails until
// someone wraps it or reviews it into the list, however the workflow reaches it: a script path in
// quotes, an action-relative path, a relative import, or a step that does not exist yet.
//
// Workflow `run` blocks, shell scripts and package.json scripts are read as shell, honouring
// quotes, so `node scripts/ci/apt-retry.mjs ... -- bash -c 'apt-get update && apt-get install'`
// is one wrapped command, while `wrapped && sudo apt-get install` is two. Everything else is read
// line by line, and any hit there needs an ALLOWLIST entry.
import { parse } from 'yaml'

export const WRAPPER = 'scripts/ci/apt-retry.mjs'

export const APT_CALL =
  /\bapt-get\b|\bapt\s+(?:-\S+\s+)*(?:install|update|upgrade|full-upgrade|dist-upgrade|remove|purge|autoremove)\b|\bdpkg\s+(?:-\S+\s+)*-i\b|--with-deps\b|\binstall-deps\b/

/** Files that mention apt calls outside the wrapper, and why each is covered. */
export const ALLOWLIST = {
  'scripts/ci/apt-retry.mjs': 'the wrapper; describes the calls it wraps',
  'scripts/ci/apt-retry-coverage.mjs': 'this inventory; its patterns name the calls',
  'scripts/ci/apt-retry.test.mjs': 'test fixtures for this inventory and the wrapper',
  'scripts/ci/share-card-browser-deps.mjs':
    'runs `playwright install --with-deps` through withAptRetries and superviseCommand after configureAptRetries (apt-retry.test.mjs checks all three)',
  'scripts/ci/share-card-browser-deps.test.mjs':
    'test fixtures and workflow assertions for the share-card installer',
}

/**
 * One shell token: a line continuation, an escaped character, a quoted string (to its end, or to
 * the end of the text when unclosed), `#` with the rest of its line (so an apostrophe in a comment
 * opens no quote), an operator, or a run of anything else.
 */
const SHELL_TOKEN =
  /\\\n|\\[\s\S]|'[^']*'?|"(?:\\[\s\S]|[^"\\])*"?|#[^\n]*|&&|\|\||>&|&>|[;\n|&>]|[^\\'"#;\n|&>]+/g
const SEPARATORS = new Set(['\n', ';', '&&', '||', '|', '&'])

/**
 * The shell commands of `text`, honouring single and double quotes and backslash escapes. A
 * newline, `;`, `&&`, `||`, `|` or `&` outside quotes ends a command; a `#` that starts a word
 * outside quotes starts a comment; a backslash before a newline continues the line.
 */
export function shellCommands(text) {
  const commands = []
  let current = ''
  const end = () => {
    const command = current.trim().replace(/\s+/g, ' ')
    if (command) commands.push(command)
    current = ''
  }
  for (const [token] of text.matchAll(SHELL_TOKEN)) {
    if (token === '\\\n') current += ' '
    else if (SEPARATORS.has(token)) end()
    // A `#` that starts a word comments out the rest of the line; inside a word it is literal.
    else if (!(token.startsWith('#') && (current === '' || /\s$/.test(current))))
      current += token
  }
  end()
  return commands
}

/** The words of one command, honouring quotes; quotes are kept off each word. */
export function shellWords(command) {
  const words = []
  let word = ''
  let quote = ''
  let started = false
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = ''
      else word += character
    } else if (character === "'" || character === '"') {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started || word) words.push(word)
      word = ''
      started = false
    } else word += character
  }
  if (started || word) words.push(word)
  return words
}

/** Whether `command` runs the wrapper: `[VAR=value ...] node <path ending in the wrapper> ...`. */
export function isWrapped(command) {
  const words = shellWords(command)
  let index = 0
  while (index < words.length && /^\w+=/.test(words[index])) index += 1
  return words[index] === 'node' && (words[index + 1] ?? '').endsWith(WRAPPER)
}

/** Hits in shell text whose command is not wrapped. */
function shellHits(text) {
  return shellCommands(text).filter(
    (command) => APT_CALL.test(command) && !isWrapped(command)
  )
}

/** Hits in text that is not shell, line by line. */
function lineHits(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => APT_CALL.test(line))
}

/** Every string in a YAML document, `run` blocks apart from the rest. */
function yamlStrings(node, key, runs, others) {
  if (typeof node === 'string') (key === 'run' ? runs : others).push(node)
  else if (Array.isArray(node))
    for (const item of node) yamlStrings(item, key, runs, others)
  else if (node && typeof node === 'object')
    for (const [child, value] of Object.entries(node))
      yamlStrings(value, child, runs, others)
}

function fileHits(file, text) {
  if (/\.ya?ml$/.test(file)) {
    const runs = []
    const others = []
    yamlStrings(parse(text), undefined, runs, others)
    return [...runs.flatMap(shellHits), ...others.flatMap(lineHits)]
  }
  if (/\.(?:sh|bash)$/.test(file) || /^#!.*\b(?:ba)?sh\b/.test(text))
    return shellHits(text)
  return lineHits(text)
}

/**
 * Apt calls outside the wrapper and the allowlist (`unwrapped`), and allowlist entries that no
 * longer match a file with a hit (`stale`), so the list stays exactly what was reviewed.
 *
 * @param {{ files: string[], read: (file: string) => string }} repo
 */
export function aptInventory({ files, read }) {
  const unwrapped = []
  const listedWithHits = new Set()
  for (const file of files) {
    if (/(?:^|\/)package\.json$/.test(file) && !file.includes('node_modules/')) {
      const scripts = JSON.parse(read(file)).scripts ?? {}
      for (const [name, body] of Object.entries(scripts))
        for (const hit of shellHits(String(body)))
          unwrapped.push(`${file} scripts.${name}: ${hit}`)
      continue
    }
    if (!/^(?:\.github|scripts)\//.test(file)) continue
    const hits = fileHits(file, read(file))
    if (!hits.length) continue
    if (file in ALLOWLIST) listedWithHits.add(file)
    else for (const hit of hits) unwrapped.push(`${file}: ${hit}`)
  }
  const stale = Object.keys(ALLOWLIST).filter((file) => !listedWithHits.has(file))
  return { unwrapped, stale }
}
