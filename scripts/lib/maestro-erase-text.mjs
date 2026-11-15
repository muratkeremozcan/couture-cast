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

/** The count an `eraseText` value names, or the reason it names none that this rule accepts. */
function checkCount(value) {
  const raw = isMap(value)
    ? value.get('charactersToErase')
    : isScalar(value)
      ? value.value
      : value
  if (raw === null || raw === undefined || raw === '')
    return `bare eraseText erases Maestro's default 50 characters; name a count of 1 to ${MAX_ERASE_TEXT_COUNT}`
  const count = typeof raw === 'number' ? raw : /^\d+$/.test(`${raw}`) ? Number(raw) : NaN
  if (!Number.isInteger(count))
    return `eraseText count ${raw} is not a literal integer, so its cost cannot be checked`
  if (count < 1 || count > MAX_ERASE_TEXT_COUNT)
    return `eraseText: ${count} is outside 1 to ${MAX_ERASE_TEXT_COUNT}; at 10 s per press under load it must fit the 120 s device deadline, so split it into several commands`
  return null
}

/** `eraseText` violations in one flow's source, as `line: reason`. */
export function eraseTextViolations(source) {
  const lineCounter = new LineCounter()
  const violations = []
  const line = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : '?')
  const visit = (node) => {
    if (isSeq(node))
      for (const item of node.items) {
        if (isScalar(item) && item.value === 'eraseText')
          violations.push(`${line(item)}: ${checkCount(null)}`)
        else visit(item)
      }
    else if (isMap(node))
      for (const pair of node.items) {
        if (!isPair(pair)) continue
        if (isScalar(pair.key) && pair.key.value === 'eraseText') {
          const reason = checkCount(pair.value)
          if (reason) violations.push(`${line(pair.key)}: ${reason}`)
        }
        visit(pair.value)
      }
  }
  for (const document of parseAllDocuments(source, { lineCounter }))
    visit(document.contents)
  return violations
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

/** The literal counts of every `eraseText` in a flow, in order. */
export function eraseTextCounts(source) {
  const counts = []
  for (const match of source.matchAll(/^\s*-\s*eraseText:\s*(\d+)\s*$/gm))
    counts.push(Number(match[1]))
  return counts
}
