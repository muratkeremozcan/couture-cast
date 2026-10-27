import { createHash } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'

const names = [
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'AggregateError',
  'URIError',
  'EvalError',
]
const secretPatterns = [
  /\b(?:https?|postgres(?:ql)?|redis):\/\/[^\s"'<>]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:Bearer\s+|(?:password|secret|token|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;}]+/gi,
  // Absolute paths only; repository-relative frames such as src/app/page.tsx stay readable.
  /(?<![\w.~-])(?:[A-Za-z]:)?\/(?:[^\s():"'<>]+\/)*[^\s():"'<>]+/g,
]
// Next prefixes failures with ⨯ and warnings with ⚠; compile, env reload and config
// restart lines show whether the failing request followed a recompilation.
const allowedLine =
  /^\s*(?:[⨯×✖⚠]\s|\w*Error:|at\s|GET (?:\/|\[redacted\])|[✓○]\s|(?:digest|code|cause):|Module not found:|Reload env:|Found a change in )/
function redact(value, secrets) {
  let text = stripVTControlCharacters(value)
  for (const secret of secrets)
    if (typeof secret === 'string' && secret.length >= 4)
      text = text.replaceAll(secret, '[redacted]')
  for (const pattern of secretPatterns) text = text.replace(pattern, '[redacted]')
  return Array.from(text)
    .filter((character) => {
      const code = character.codePointAt(0)
      return (code >= 32 && code !== 127) || ['\t', '\n', '\r'].includes(character)
    })
    .join('')
    .slice(0, 1024)
}
function pagesError(body) {
  const script = body.match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  )
  if (!script) return null
  try {
    const parsed = JSON.parse(script[1])
    return parsed?.err && typeof parsed.err === 'object' ? parsed.err : null
  } catch {
    return null
  }
}
/** App Router streams a server render error as a Flight `<id>:E{...}` row. */
function flightError(body) {
  const chunks = []
  for (const match of body.matchAll(
    /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  )) {
    try {
      chunks.push(JSON.parse(match[1]))
    } catch {
      // A malformed chunk cannot carry a parseable error row.
    }
  }
  for (const line of chunks.join('').split('\n')) {
    const row = line.match(/^[0-9a-f]+:E(\{.*\})$/)
    if (!row) continue
    try {
      const parsed = JSON.parse(row[1])
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Keep looking for a complete error row.
    }
  }
  return null
}
/** A failed App Router shell falls back to a template carrying the error attributes. */
function templateError(body) {
  const tag = body.match(/<template\b[^>]*\bdata-next-error-message=[^>]*>/)
  if (!tag) return null
  const attribute = (name) => {
    const value = tag[0].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
    return value
      ?.replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
  }
  return {
    name: 'Error',
    message: attribute('data-next-error-message'),
    digest: attribute('data-next-error-digest'),
  }
}
function nextError(body) {
  if (typeof body !== 'string') return null
  return pagesError(body) ?? flightError(body) ?? templateError(body)
}
export function summarizeStartupFailure({ body, log, secrets = [] }) {
  const error = nextError(body)
  const logTail = (typeof log === 'string' ? stripVTControlCharacters(log) : '')
    .split(/\r?\n/)
    .filter((line) => allowedLine.test(line))
    .slice(-40)
    .map((line) => redact(line, secrets))
  const errors = []
  const add = (name, message) => {
    if (names.includes(name) && typeof message === 'string' && errors.length < 8) {
      const value = { name, message: redact(message, secrets) }
      if (!errors.some((prior) => prior.name === name && prior.message === value.message))
        errors.push(value)
    }
  }
  add(error?.name, error?.message)
  for (const line of logTail) {
    const match = line.match(/\b(\w*Error):\s*(.*)/)
    if (match) add(match[1], match[2])
  }
  const nextDigest =
    typeof error?.digest === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(error.digest)
      ? error.digest
      : null
  const value = {
    bodySha256:
      typeof body === 'string' ? createHash('sha256').update(body).digest('hex') : null,
    nextDigest,
    errors,
    logTail,
  }
  assertStartupFailure(value)
  return value
}
function exact(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}
function safeText(value) {
  if (typeof value !== 'string' || value.length > 1024) return false
  return secretPatterns.every((pattern) => {
    pattern.lastIndex = 0
    return !pattern.test(value)
  })
}
export function assertStartupFailure(value) {
  if (
    !exact(value, ['bodySha256', 'nextDigest', 'errors', 'logTail']) ||
    !(value.bodySha256 === null || /^[a-f0-9]{64}$/.test(value.bodySha256)) ||
    !(value.nextDigest === null || /^[A-Za-z0-9_-]{1,128}$/.test(value.nextDigest)) ||
    !Array.isArray(value.errors) ||
    value.errors.length > 8 ||
    !value.errors.every(
      (error) =>
        exact(error, ['name', 'message']) &&
        names.includes(error.name) &&
        safeText(error.message)
    ) ||
    !Array.isArray(value.logTail) ||
    value.logTail.length > 40 ||
    !value.logTail.every((line) => safeText(line) && allowedLine.test(line))
  )
    throw new Error('invalid_web_startup_failure_details')
}
