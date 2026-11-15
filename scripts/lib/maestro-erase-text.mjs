/**
 * Every Maestro `eraseText` must name its count, and the count must fit the device deadline.
 *
 * On Android each erased character is one DEL key press, and UiAutomator waits up to 10 s for
 * the app to go idle before every press. A loaded CI emulator never goes idle, so each press
 * costs the full 10 s, while the whole `eraseText` command has one 120 s gRPC deadline. A bare
 * `eraseText` erases 50 characters (500 s at that rate); job 132977352556 died on one with
 * `DEADLINE_EXCEEDED` after 13 presses. 10 presses are 100 s at worst, inside the deadline with
 * 20 s to spare. Longer text is cleared in several commands, since the deadline is per command.
 */
import fs from 'node:fs'
import path from 'node:path'
import { LineCounter, isMap, isPair, isScalar, isSeq, parseAllDocuments } from 'yaml'

export const MAX_ERASE_TEXT_COUNT = 10

/** What a bare `eraseText` erases, per Maestro's docs. */
export const MAESTRO_DEFAULT_ERASE_COUNT = 50

/** The count an `eraseText` value names: an integer, NaN when it is not a literal, or null when bare. */
function countOf(value) {
  const raw = isMap(value)
    ? value.get('charactersToErase')
    : isScalar(value)
      ? value.value
      : value
  if (raw === null || raw === undefined || raw === '') return { raw, count: null }
  const count = typeof raw === 'number' ? raw : /^\d+$/.test(`${raw}`) ? Number(raw) : NaN
  return { raw, count: Number.isInteger(count) ? count : NaN }
}

/** Why an `eraseText` value breaks this rule, or null when its count is bounded. */
function checkCount(value) {
  const { raw, count } = countOf(value)
  if (count === null)
    return `bare eraseText erases Maestro's default ${MAESTRO_DEFAULT_ERASE_COUNT} characters; name a count of 1 to ${MAX_ERASE_TEXT_COUNT}`
  if (Number.isNaN(count))
    return `eraseText count ${raw} is not a literal integer, so its cost cannot be checked`
  if (count < 1 || count > MAX_ERASE_TEXT_COUNT)
    return `eraseText: ${count} is outside 1 to ${MAX_ERASE_TEXT_COUNT}; at 10 s per press under load it must fit the 120 s device deadline, so split it into several commands`
  return null
}

/**
 * Every `eraseText` command in one flow's source, in document order, as `{ line, value }`. `value`
 * is the command's YAML node (a scalar count or a `charactersToErase` mapping), or null for a bare
 * list item. The deadline rule and the erased-count totals both walk these, so every form one
 * accepts the other counts.
 */
function eraseTextCommands(source) {
  const lineCounter = new LineCounter()
  const commands = []
  const line = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : '?')
  const visit = (node) => {
    if (isSeq(node))
      for (const item of node.items) {
        if (isScalar(item) && item.value === 'eraseText')
          commands.push({ line: line(item), value: null })
        else visit(item)
      }
    else if (isMap(node))
      for (const pair of node.items) {
        if (!isPair(pair)) continue
        if (isScalar(pair.key) && pair.key.value === 'eraseText')
          commands.push({ line: line(pair.key), value: pair.value })
        visit(pair.value)
      }
  }
  for (const document of parseAllDocuments(source, { lineCounter }))
    visit(document.contents)
  return commands
}

/** `eraseText` violations in one flow's source, as `line: reason`. */
export function eraseTextViolations(source) {
  return eraseTextCommands(source).flatMap(({ line, value }) => {
    const reason = checkCount(value)
    return reason ? [`${line}: ${reason}`] : []
  })
}

/** Every Maestro flow under `maestro/`, repo-relative and sorted. */
export function maestroFlowFiles(root, dir = 'maestro') {
  return fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) return maestroFlowFiles(root, file)
      return /\.ya?ml$/.test(entry.name) ? [file] : []
    })
    .sort()
}

/**
 * The characters every `eraseText` in a flow erases, in order, in both the scalar and the
 * `charactersToErase` form. A bare command counts Maestro's default; a non-literal count is NaN,
 * so any total over it fails an exact check.
 */
export function eraseTextCounts(source) {
  return eraseTextCommands(source).map(({ value }) => {
    const { count } = countOf(value)
    return count === null ? MAESTRO_DEFAULT_ERASE_COUNT : count
  })
}
