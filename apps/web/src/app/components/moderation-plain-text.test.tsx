// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-HOSTILE-TEXT at the component that owns the rule (D9, TEA-16).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlainText, revealBidiControls } from './moderation-plain-text'

const RLO = String.fromCodePoint(0x202e)
const PDF = String.fromCodePoint(0x202c)
const ZWSP = String.fromCodePoint(0x200b)
const ZWJ = String.fromCodePoint(0x200d)
const hostile = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  '**bold** _italic_ `code` # heading',
  '&lt;b&gt;entity&lt;/b&gt;',
  `zero${ZWSP}width${ZWJ}joiner`,
  'line one\nline two\n\n\nline five',
  'x'.repeat(500),
  '',
]

const BIDI_CONTROLS = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
] as const
const hex = (code: number) => code.toString(16).toUpperCase()

describe('PlainText', () => {
  it.each(hostile)('renders %j as one text node and nothing else', (value) => {
    const { container } = render(<PlainText value={value} />)
    expect(
      container.querySelectorAll('script, img, a, b, i, strong, em, code, h1, iframe')
    ).toHaveLength(0)
    const bdi = container.querySelector('bdi')!
    expect(bdi.childNodes).toHaveLength(value === '' ? 0 : 1)
    expect(bdi.textContent).toBe(value)
    expect(container.innerHTML).not.toContain('<script')
  })

  it.each(BIDI_CONTROLS)(
    'shows U+%s as a visible marker and never renders the character',
    (code) => {
      const control = String.fromCodePoint(code)
      const { container } = render(<PlainText value={`before${control}after`} />)
      const bdi = container.querySelector('bdi')!
      expect(bdi.childNodes).toHaveLength(1)
      expect(bdi.textContent).toBe(`before<U+${hex(code)}>after`)
      expect(container.textContent).not.toContain(control)
    }
  )

  it('marks a spoofing override such as RLO ... PDF so the moderator reads the real order', () => {
    const { container } = render(<PlainText value={`${RLO}evil.exe${PDF}`} />)
    expect(container.textContent).toBe('<U+202E>evil.exe<U+202C>')
  })

  it('leaves ordinary right-to-left text, zero-width characters and emoji unchanged', () => {
    const plain = `שלום עולם مرحبا zero${ZWSP}width${ZWJ}joiner 👨‍👩‍👧`
    expect(revealBidiControls(plain)).toBe(plain)
    const { container } = render(<PlainText value={plain} />)
    expect(container.textContent).toBe(plain)
  })

  it('reveals every control in a string that carries several, and is idempotent on its output', () => {
    const all = BIDI_CONTROLS.map((code) => String.fromCodePoint(code)).join('')
    const shown = revealBidiControls(all)
    expect(shown).toBe(BIDI_CONTROLS.map((code) => `<U+${hex(code)}>`).join(''))
    expect(revealBidiControls(shown)).toBe(shown)
  })

  it('wraps, preserves line breaks and isolates bidi', () => {
    const { container } = render(<PlainText value="x" className="font-medium" />)
    const holder = container.firstElementChild!
    expect(holder.tagName).toBe('SPAN')
    expect(holder.className).toBe(
      'whitespace-pre-wrap [overflow-wrap:anywhere] font-medium'
    )
    expect(holder).toHaveAttribute('dir', 'auto')
    expect(holder).toHaveStyle({ unicodeBidi: 'isolate' })
  })

  it('renders inside the element the caller chooses', () => {
    const { container } = render(<PlainText value="note" as="p" />)
    expect(container.firstElementChild!.tagName).toBe('P')
  })

  it('has no console module that injects HTML or builds a link from user text', () => {
    const dir = join(__dirname)
    const sources = readdirSync(dir).filter(
      (name) => /^moderation-.*\.tsx$/.test(name) && !name.endsWith('.test.tsx')
    )
    expect(sources.length).toBeGreaterThanOrEqual(5)
    for (const name of sources) {
      const code = readFileSync(join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(code, name).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|markdown|marked|DOMPurify|\bhref=\{[^}]*(excerpt|details|caption|alias|body)/
      )
    }
  })
})
