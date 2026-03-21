import { expect } from 'vitest'

export type MemoryLogEntry = Record<string, unknown> & {
  level?: string
  message?: string
}

type LogExpectationOptions = {
  afterIndex?: number
  count?: number
}

const formatCapturedLogs = (entries: readonly MemoryLogEntry[]) =>
  entries
    .map(
      ({ level, message }) =>
        `${typeof level === 'string' ? level : 'unknown'}:${typeof message === 'string' ? message : 'unknown'}`
    )
    .join(', ')

export function createLogExpectations(entries: readonly MemoryLogEntry[]) {
  return {
    createCursor() {
      return entries.length
    },

    expectLogEntry(
      level: string,
      message: string,
      context: Record<string, unknown> = {},
      options: LogExpectationOptions = {}
    ) {
      const scopedEntries =
        options.afterIndex === undefined ? entries : entries.slice(options.afterIndex)
      const matchingEntries = scopedEntries.filter(
        (entry) => entry.level === level && entry.message === message
      )

      if (options.count !== undefined) {
        expect(
          matchingEntries,
          `Expected ${options.count} "${level}:${message}" log entr(y/ies) after cursor ${options.afterIndex ?? 0}. Captured: ${formatCapturedLogs(scopedEntries)}`
        ).toHaveLength(options.count)
      } else {
        expect(
          matchingEntries.length,
          `Expected structured log "${level}:${message}" to be emitted. Captured: ${formatCapturedLogs(scopedEntries)}`
        ).toBeGreaterThan(0)
      }

      const logEntry = matchingEntries.at(-1)
      expect(logEntry ?? {}).toEqual(
        expect.objectContaining({
          level,
          message,
          ...context,
        })
      )

      return logEntry as MemoryLogEntry
    },
  }
}
