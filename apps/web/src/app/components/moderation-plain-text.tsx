// Story 6.10 web owner: the one component that renders user-authored text in the moderator console.
// Reporter details, captions, alt text, comment bodies, operator notes and aliases are untrusted.
// They render as a single React text node: never markdown, never HTML, never a link.
import type { ElementType } from 'react'

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g

/**
 * Bidirectional controls would let the author reorder what the moderator reads, so each one shows
 * as a visible marker such as `<U+202E>` inside the same text node. The characters themselves are
 * never rendered.
 */
export function revealBidiControls(value: string): string {
  return value.replace(
    BIDI_CONTROLS,
    (control) => `<U+${control.codePointAt(0)?.toString(16).toUpperCase()}>`
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
