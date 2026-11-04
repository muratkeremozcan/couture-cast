// Story 6.10 web owner: the one component that renders user-authored text in the moderator console.
// Reporter details, captions, alt text, comment bodies, operator notes and aliases are untrusted.
// They render as a single React text node: never markdown, never HTML, never a link.
import type { ElementType } from 'react'

// Directional controls: marks (U+200E, U+200F, U+061C), embeddings and overrides (U+202A to U+202E)
// and isolates (U+2066 to U+2069).
const BIDI_CONTROLS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g
// A marker an author typed by hand. It gets one extra backslash so it never reads as a revealed control.
const TYPED_MARKER = /(\\*)(<U\+[0-9A-Fa-f]{4,6}>)/g

/**
 * Bidirectional controls would let the author reorder what the moderator reads, so each one shows
 * as a visible marker such as `<U+202E>` inside the same text node. The characters themselves are
 * never rendered. Text the author typed that looks like a marker is escaped with a backslash and
 * its own backslashes are doubled, so a bare `<U+202E>` always means a real control.
 */
export function revealBidiControls(value: string): string {
  return value
    .replace(
      TYPED_MARKER,
      (_match, slashes: string, marker: string) => `${slashes}${slashes}\\${marker}`
    )
    .replace(
      BIDI_CONTROLS,
      (control) =>
        `<U+${control.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}>`
    )
}

export function PlainText({
  value,
  as: Tag = 'span',
  className = '',
}: {
  value: string
  as?: ElementType
  className?: string
}) {
  return (
    // `bdi` plus `unicode-bidi: isolate` keep a bidi override in the text from reordering its surroundings.
    <Tag
      className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${className}`.trim()}
      style={{ unicodeBidi: 'isolate' }}
      dir="auto"
    >
      <bdi>{revealBidiControls(value)}</bdi>
    </Tag>
  )
}
