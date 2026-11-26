// Story CC-7.9 D10: the design token guard. The builder owns the clean-tree case (GRD-008);
// TEA adds the mutation cases GRD-001..007 against fixture trees in a temp dir.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-design-tokens.mjs', import.meta.url))

function runGuard(args = []) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

/**
 * TEA mutation cases: a fixture tree holding `files` (repo-relative path to source), the guard
 * run against it. Every offending line sits on line 3 under two clean lines, so a wrong line
 * number fails the case as surely as a missed offence.
 */
function guardTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-tokens-mutant-'))
  try {
    for (const [relative, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), source)
    }
    return runGuard(['--root', root])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const WEB_FILE = 'apps/web/src/app/mutant/page.tsx'
const NATIVE_FILE = 'apps/mobile/src/features/mutant/screen.tsx'
const CLEAN_WEB =
  'import { x } from \'./x\'\nexport const a = <p className="text-ink" />\n'
const CLEAN_NATIVE = "import { x } from './x'\nexport const a = tokens.colors.ink\n"
const webLine = (line) => `${CLEAN_WEB}${line}\n`
const nativeLine = (line) => `${CLEAN_NATIVE}${line}\n`

/** The guard fails and names `file:3` for each source line in `lines`. */
function expectFlagged(file, wrap, lines) {
  for (const line of lines) {
    const result = guardTree({ [file]: wrap(line) })
    assert.equal(result.status, 1, `not flagged: ${line}\n${result.stdout}`)
    assert.match(
      result.stderr,
      new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3: `, 'm'),
      line
    )
  }
}

describe('check-design-tokens', () => {
  test('7.9-GRD-008 the branch tree is clean', () => {
    const result = runGuard()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /check-design-tokens: clean/)
  })

  test('7.9-GRD-001 a Tailwind palette class fails, naming file and line', () => {
    expectFlagged(WEB_FILE, webLine, [
      'export const b = <p className="bg-amber-300" />',
      'export const b = <p className="px-4 text-zinc-500" />',
      'export const b = <p className="hover:border-neutral-200" />',
      'export const b = <p className="bg-white" />',
      "export const b = cn('ring-yellow-400', active && 'text-black')",
    ])
  })

  test('7.9-GRD-002 an arbitrary colour value fails', () => {
    expectFlagged(WEB_FILE, webLine, [
      'export const b = <p className="bg-[#fff]" />',
      'export const b = <p className="text-[rgb(0,0,0)]" />',
      'export const b = <p className="bg-[var(--lookbook-card)]" />',
      'export const b = <p className="border-[color:red]" />',
    ])
  })

  test('7.9-GRD-003 a raw hex or rgb() in web code or CSS fails', () => {
    expectFlagged(WEB_FILE, webLine, [
      "export const b = { color: '#C9A14A' }",
      "export const b = <p style={{ background: 'rgba(17, 17, 25, 0.2)' }} />",
      'export const b = `border: 1px solid #111`',
    ])
    expectFlagged(
      'apps/web/src/app/mutant.css',
      (line) => `.a {\n  color: rgb(var(--cc-ink));\n${line}\n}\n`,
      ['  background: #121214;', '  border-color: rgba(0, 0, 0, 0.1);']
    )
  })

  test('7.9-GRD-004 a dark: colour variant fails; the scheme comes from the roles', () => {
    expectFlagged(WEB_FILE, webLine, [
      'export const b = <p className="bg-page dark:bg-card" />',
      'export const b = <p className="dark:hover:text-ink" />',
    ])
  })

  test('7.9-GRD-005 off-scale spacing, type, radius and shadow classes fail', () => {
    expectFlagged(WEB_FILE, webLine, [
      'export const b = <p className="p-7" />',
      'export const b = <p className="gap-[13px]" />',
      'export const b = <p className="-mt-9" />',
      'export const b = <p className="text-4xl" />',
      'export const b = <p className="text-[15px]" />',
      'export const b = <p className="rounded-3xl" />',
      'export const b = <p className="rounded-[10px]" />',
      'export const b = <p className="shadow-2xl" />',
    ])
    // On the scale (D4): no finding.
    const clean = guardTree({
      [WEB_FILE]: webLine(
        'export const b = <p className="p-5 gap-14 mt-0.5 text-3xl rounded-xl shadow-overlay" />'
      ),
    })
    assert.equal(clean.status, 0, clean.stderr)
  })

  test('7.9-GRD-006 a native hex, rgb() or named colour literal fails', () => {
    expectFlagged(NATIVE_FILE, nativeLine, [
      "export const s = { backgroundColor: '#FFFFFF' }",
      "export const s = { color: 'rgba(0,0,0,0.5)' }",
      "export const s = { color: 'white' }",
      'export const s = <Icon tintColor="gold" />',
    ])
    expectFlagged('apps/mobile/components/mutant.tsx', nativeLine, [
      "export const s = { borderColor: '#C9A14A' }",
    ])
    expectFlagged('apps/mobile/app/(tabs)/mutant.tsx', nativeLine, [
      "export const s = { shadowColor: 'black' }",
    ])
  })

  test('7.9-GRD-007 exemptions cover only their files and rules; tests and comments are never scanned', () => {
    const line = "export const s = { backgroundColor: '#FFFFFF' }"
    // Exempt for every rule: the share-card PNG composer.
    assert.equal(
      guardTree({ 'apps/mobile/components/share-card-composer.tsx': nativeLine(line) })
        .status,
      0
    )
    // The same line in a sibling that is not exempt fails.
    expectFlagged('apps/mobile/components/share-card-preview.tsx', nativeLine, [line])
    // Moderation is exempt for spacing only: off-scale spacing passes, a palette class fails.
    const moderation = 'apps/web/src/app/moderation/mutant/page.tsx'
    assert.equal(
      guardTree({ [moderation]: webLine('export const b = <p className="p-7" />') })
        .status,
      0
    )
    expectFlagged(moderation, webLine, [
      'export const b = <p className="p-7 bg-red-500" />',
    ])
    // Test files and comments.
    assert.equal(
      guardTree({
        'apps/web/src/app/mutant/page.test.tsx': webLine('const b = "bg-amber-300 #fff"'),
        'apps/mobile/src/features/mutant/screen.test.tsx': nativeLine(
          "const s = { color: 'white' }"
        ),
        [WEB_FILE]: webLine('// was bg-amber-300 and #C9A14A before CC-7.9'),
        [NATIVE_FILE]: nativeLine("/* color: 'white' before CC-7.9 */"),
      }).status,
      0
    )
  })

  test('7.9-GRD-009 a web named colour in a style object or SVG paint attribute fails', () => {
    expectFlagged(WEB_FILE, webLine, [
      "export const b = <p style={{ color: 'white' }} />",
      "export const b = <p style={{ backgroundColor: 'black' }} />",
      'export const b = <svg fill="gold" />',
      'export const b = <path stroke="red" />',
      'export const b = <stop stopColor="silver" />',
    ])
    const clean = guardTree({
      [WEB_FILE]: webLine(
        'export const b = <svg fill="currentColor" stroke="none"><stop stopColor="transparent" /></svg>'
      ),
    })
    assert.equal(clean.status, 0, clean.stderr)
  })

  test('7.9-GRD-010 a colour utility that names no token role fails (it would emit no CSS)', () => {
    expectFlagged(WEB_FILE, webLine, [
      'export const b = <p className="bg-gold" />',
      'export const b = <p className="text-foreground" />',
      'export const b = <p className="border-lookbook-line" />',
      'export const b = <p className="hover:bg-gold-soft/40" />',
      'export const b = <p className="ring-champagne" />',
    ])
    // Roles, the three keywords, alpha, sizes, alignment and widths stay allowed.
    const clean = guardTree({
      [WEB_FILE]: webLine(
        'export const b = <p className="bg-page text-ink border-line ring-focus bg-primary/90 bg-transparent text-current border-inherit text-sm text-center text-3xl border border-2 ring-2 outline-none" />'
      ),
    })
    assert.equal(clean.status, 0, clean.stderr)
  })

  test('7.9-GRD-011 an interpolated colour class and an upper-case named colour fail', () => {
    expectFlagged(WEB_FILE, webLine, [
      // Tailwind never sees a class built at run time, so it emits no CSS for it.
      'export const b = <p className={`bg-${tone}`} />',
      'export const b = <p className={`px-4 text-${tone}-ink`} />',
      "export const b = <p style={{ fill: 'GOLD' }} />",
    ])
    expectFlagged(NATIVE_FILE, nativeLine, ["export const s = { color: 'White' }"])
  })

  test('7.9-GRD-012 native literal type, radius and spacing must sit on the D4 scale', () => {
    expectFlagged(NATIVE_FILE, nativeLine, [
      'export const s = { fontSize: 13 }',
      'export const s = { borderRadius: 10 }',
      'export const s = { borderTopLeftRadius: 6 }',
      'export const s = { padding: 10 }',
      'export const s = { paddingHorizontal: 18 }',
      'export const s = { marginTop: -7 }',
      'export const s = { gap: 9 }',
      'export const s = { columnGap: 66 }',
    ])
    const clean = guardTree({
      [NATIVE_FILE]: nativeLine(
        'export const s = { fontSize: 14, borderRadius: 9999, borderTopLeftRadius: 4, padding: 16, paddingHorizontal: 20, marginTop: -8, gap: 12, rowGap: 0, columnGap: 64, width: 13 }'
      ),
    })
    assert.equal(clean.status, 0, clean.stderr)
  })

  test('a fixture tree written only in token roles exits 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-tokens-clean-'))
    try {
      const web = path.join(root, 'apps/web/src/app')
      const native = path.join(root, 'apps/mobile/src/features')
      fs.mkdirSync(web, { recursive: true })
      fs.mkdirSync(native, { recursive: true })
      fs.writeFileSync(
        path.join(web, 'screen.tsx'),
        'export const Screen = () => <main data-surface="page" className="bg-page px-4 py-6 text-ink rounded-lg shadow-card" />\n'
      )
      fs.writeFileSync(
        path.join(native, 'screen.tsx'),
        'export const styles = { card: { backgroundColor: tokens.colors.card, padding: 16 } }\n'
      )
      const result = runGuard(['--root', root])
      assert.equal(result.status, 0, result.stderr)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
