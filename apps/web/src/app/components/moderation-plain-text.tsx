// Story 6.10 web owner: the one component that renders user-authored text in the moderator console.
// Reporter details, captions, alt text, comment bodies, operator notes and aliases are untrusted.
// They render as a single React text node: never markdown, never HTML, never a link.
import type { ElementType } from 'react'

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
      <bdi>{value}</bdi>
    </Tag>
  )
}
