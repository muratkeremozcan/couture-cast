#!/usr/bin/env node
// Story CC-7.9 D10 owner: the design token guard the PR gate runs.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
//
// `packages/utils/src/design-tokens.ts` is the only place a color, type size, spacing step,
// radius or shadow is written down. Web reads it through `apps/web/tailwind.config.ts`, whose
// `colors` holds the token roles only, so a Tailwind palette class (`bg-amber-300`) silently
// emits no CSS. This guard fails on any such class, raw color or off-scale value outside the
// token module and names `file:line` for each.
//
// Usage: node scripts/check-design-tokens.mjs [--root <dir>] [file ...]
// With files, only those (repo-relative or absolute) are checked; otherwise both app trees.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url))

/**
 * The color names Tailwind knows (`apps/web/tailwind.config.ts`): every D2 role and premium
 * palette carrier, kebab-cased, read from the token module's source so this list cannot drift
 * from it, plus the three CSS keywords.
 */
function loadColorNames() {
  const source = fs.readFileSync(
    path.join(REPOSITORY, 'packages/utils/src/design-tokens.ts'),
    'utf8'
  )
  const list = (name) => {
    const block = source.match(
      new RegExp(`export const ${name} = [^\\[]*\\[([^\\]]*)\\]`)
    )
    if (!block)
      throw new Error(`check-design-tokens: ${name} not found in design-tokens.ts`)
    return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1])
  }
  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  return new Set([
    'transparent',
    'current',
    'inherit',
    ...list('COLOR_ROLE_NAMES').map(kebab),
    ...list('PREMIUM_PALETTE_FIELDS').map((field) => `theme-${kebab(field)}`),
  ])
}
export const COLOR_NAMES = loadColorNames()

/** Files scanned per app. Tests and test support never are. */
const WEB = { root: 'apps/web/src', extensions: ['.ts', '.tsx', '.css'] }
const NATIVE = {
  roots: ['apps/mobile/app', 'apps/mobile/src', 'apps/mobile/components'],
  extensions: ['.ts', '.tsx'],
}
const TEST_FILE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:\/__tests__\/)|(?:\/__mocks__\/)|(?:\/test-utils\/)|(?:\.test-(?:support|boundary)\.[jt]sx?$)/

/**
 * Exemptions. Each entry names why the file is not a screen. `all` skips every rule; `spacing`
 * skips only the spacing rule.
 */
export const EXEMPTIONS = [
  // A rendered PNG, not a screen: the share card's pixels are pinned by Story 6.9's proof hash.
  { path: 'apps/mobile/components/share-card-composer.tsx', rules: 'all' },
  // Flattens an uploaded garment photo onto white before it is encoded: image bytes, not UI.
  { path: 'apps/web/src/lib/wardrobe.ts', rules: 'all' },
  // Staff-only moderation pages: dense tables keep their own spacing (colors still use roles).
  { prefix: 'apps/web/src/app/moderation/', rules: 'spacing' },
  { prefix: 'apps/web/src/app/components/moderation-', rules: 'spacing' },
]

function exemptionFor(relative) {
  return EXEMPTIONS.find((entry) =>
    entry.path ? entry.path === relative : relative.startsWith(entry.prefix)
  )
}

const PALETTE_NAMES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOR_UTILITIES =
  'bg|text|border(?:-[xytrblse])?|ring|ring-offset|from|via|to|fill|stroke|outline|divide|placeholder|accent|shadow|decoration|caret'
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES})-(?:(?:${PALETTE_NAMES})-\\d{2,3}|white|black)(?![\\w-])`,
  'g'
)
/**
 * Every color-capable utility. Its value must be a token color (with an optional `/alpha`) or one
 * of the utility's non-color keys below; anything else emits no CSS once `colors` holds only the
 * roles, so a typo or an old palette name would silently paint nothing.
 */
const COLOR_UTILITY =
  /(?<![\w\-[,])-?(bg|text|border|ring-offset|ring|fill|stroke|outline-offset|outline|divide|from|via|to|accent|caret|decoration|placeholder)(?:-([a-z0-9][a-z0-9.%-]*))?(?:\/(?:\d+|\[[^\]\s]*\]))?(?![\w\-/[])/g
const WIDTH = '(?:0|1|2|4|8)'
const SIDE = '(?:x|y|t|r|b|l|s|e)'
const NON_COLOR_KEYS = {
  bg: /^(?:fixed|local|scroll|clip-(?:border|padding|content|text)|origin-(?:border|padding|content)|no-repeat|repeat(?:-x|-y|-round|-space)?|auto|cover|contain|center|top|bottom|left|right|(?:left|right)-(?:top|bottom)|none|gradient-to-(?:t|tr|r|br|b|bl|l|tl)|blend-[a-z-]+)$/,
  text: /^(?:xs|sm|base|lg|xl|2xl|3xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
  border: new RegExp(
    `^(?:${WIDTH}|${SIDE}|${SIDE}-${WIDTH}|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-[0-9.]+)$`
  ),
  ring: new RegExp(`^(?:${WIDTH}|inset)$`),
  'ring-offset': new RegExp(`^${WIDTH}$`),
  outline: new RegExp(`^(?:none|${WIDTH}|dashed|dotted|double|solid)$`),
  'outline-offset': new RegExp(`^${WIDTH}$`),
  divide: new RegExp(
    `^(?:x|y|x-${WIDTH}|y-${WIDTH}|x-reverse|y-reverse|solid|dashed|dotted|double|none)$`
  ),
  from: /^\d+%$/,
  via: /^\d+%$/,
  to: /^\d+%$/,
  fill: /^none$/,
  stroke: /^(?:none|0|1|2)$/,
  accent: /^auto$/,
  caret: /^$/,
  decoration: new RegExp(
    `^(?:solid|double|dotted|dashed|wavy|auto|from-font|clone|slice|${WIDTH})$`
  ),
  placeholder: /^$/,
}
function colorUtilityAllowed(utility, value) {
  // A bare `border`, `ring` or `outline` is a width; a bare `text` or `to` is an English word.
  if (value === undefined) return true
  // `text-4xl` and up are reported by the type scale rule.
  if (utility === 'text' && /^[4-9]xl$/.test(value)) return true
  if (COLOR_NAMES.has(value)) return true
  if (NON_COLOR_KEYS[utility]?.test(value)) return true
  // A side color: `border-t-line`, `border-x-line-strong`.
  if (utility === 'border') {
    const side = value.match(/^(?:x|y|t|r|b|l|s|e)-(.+)$/)
    if (side && COLOR_NAMES.has(side[1])) return true
  }
  return false
}

const ARBITRARY_COLOR = /-\[(?:#|rgba?\(|hsla?\(|var\(--|color:|color-mix)/g
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const RAW_FUNCTION = /(?<![\w-])(?:rgba?|hsla?)\((?!var\(--cc-)/g
const DARK_COLOR = new RegExp(`(?<![\\w-])dark:(?:[a-z-]+:)*(?:${COLOR_UTILITIES})-`, 'g')
const SPACING_SCALE = new Set([
  '0',
  '0.5',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '8',
  '10',
  '12',
  '14',
  '16',
])
const SPACING_NAMES = new Set(['safe', 'tab-bar'])
const SPACING_CLASS =
  /(?<![\w-])-?(gap-x|gap-y|gap|space-x|space-y|px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m)-(\d+(?:\.\d+)?|px|safe|tab-bar|auto|\[[^\]\s]*\])(?![\w-])/g
const TEXT_SIZE =
  /(?<![\w-])text-(?:[4-9]xl|\[(?!color:|#|rgba?\(|hsla?\(|var\(|color-mix)[^\]\s]*\])/g
const RADIUS_CLASS =
  /(?<![\w-])rounded(?:-(?:tl|tr|br|bl|ss|se|es|ee|t|r|b|l|s|e))?(?:-([a-z0-9]+|\[[^\]\s]*\]))?(?![\w-])/g
const RADIUS_SCALE = new Set(['none', 'sm', 'md', 'lg', 'xl', 'full'])
const SHADOW_CLASS = /(?<![\w-])shadow(?:-([a-z0-9-]+|\[[^\]\s]*\]))?(?![\w-[])/g
const SHADOW_SCALE = new Set(['none', 'card', 'overlay'])
const NAMED_COLORS =
  'white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver|gold|navy|teal|brown|maroon|olive|lime|aqua|fuchsia'
/** A named color as a style value or an SVG paint attribute (`color: 'white'`, `fill="gold"`). */
const NAMED_COLOR = new RegExp(
  `(?:color|\\bfill|\\bstroke|background)\\s*[:=]\\s*\\{?\\s*['"\`](?:${NAMED_COLORS})['"\`]`,
  'gi'
)

/** A color utility whose value is built at run time (`bg-${tone}`): Tailwind never sees it. */
const INTERPOLATED_COLOR_UTILITY =
  /(?<![\w\-[,])(?:[a-z0-9-]+:)*-?(?:bg|text|border(?:-[xytrblse])?|ring-offset|ring|fill|stroke|outline|divide|from|via|to|accent|caret|decoration|placeholder|shadow)-$/

/**
 * Splits JS/TS source into string-literal segments (with line numbers), dropping comments. Quote
 * strings end at a newline, so one stray apostrophe in JSX text cannot swallow the rest of the
 * file. A template segment that stops at `${` is marked `interpolated`.
 */
export function splitSource(source) {
  const scan = {
    source,
    index: 0,
    line: 1,
    state: 'code',
    current: null,
    depth: [],
    strings: [],
  }
  while (scan.index < scan.source.length) {
    const char = scan.source[scan.index]
    if (char === '\n') scan.line += 1
    STATES[scan.state](scan, char, scan.source[scan.index + 1])
  }
  if (scan.current) scan.strings.push(scan.current)
  return { strings: scan.strings }
}

function openString(scan, state) {
  scan.state = state
  scan.current = { line: scan.line, text: '' }
}

function closeString(scan, interpolated = false) {
  if (interpolated) scan.current.interpolated = true
  scan.strings.push(scan.current)
  scan.current = null
  scan.state = 'code'
}

const QUOTES = new Set(['"', "'", '`'])

const STATES = {
  code(scan, char, next) {
    if (char === '/' && (next === '/' || next === '*')) {
      scan.state = next === '/' ? 'line-comment' : 'block-comment'
      scan.index += 2
      return
    }
    scan.index += 1
    if (QUOTES.has(char)) return openString(scan, char)
    const depth = scan.depth
    if (!depth.length) return
    if (char === '}' && depth.at(-1) === 0) {
      depth.pop()
      return openString(scan, '`')
    }
    if (char === '{') depth[depth.length - 1] += 1
    if (char === '}') depth[depth.length - 1] -= 1
  },
  'line-comment'(scan, char) {
    scan.index += 1
    if (char === '\n') scan.state = 'code'
  },
  'block-comment'(scan, char, next) {
    if (char === '*' && next === '/') {
      scan.state = 'code'
      scan.index += 2
      return
    }
    scan.index += 1
  },
  '`'(scan, char, next) {
    if (escape(scan, char, next)) return
    if (char === '$' && next === '{') {
      closeString(scan, true)
      scan.depth.push(0)
      scan.index += 2
      return
    }
    scan.index += 1
    if (char === '`') closeString(scan)
    else scan.current.text += char
  },
  '"'(scan, char, next) {
    quoted(scan, char, next)
  },
  "'"(scan, char, next) {
    quoted(scan, char, next)
  },
}

function escape(scan, char, next) {
  if (char !== '\\') return false
  scan.current.text += char + (next ?? '')
  if (next === '\n') scan.line += 1
  scan.index += 2
  return true
}

function quoted(scan, char, next) {
  if (escape(scan, char, next)) return
  scan.index += 1
  if (char === scan.state || char === '\n') closeString(scan)
  else scan.current.text += char
}

/** Each match in `text`, with the line it sits on (`text` starts on `firstLine`). */
function* matches(pattern, text, firstLine) {
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index)
    yield { match, line: firstLine + (before.match(/\n/g)?.length ?? 0) }
  }
}

const PALETTE_TOKEN = new RegExp(
  `^(?:[a-z0-9-]+:)*-?(?:${COLOR_UTILITIES})-(?:(?:${PALETTE_NAMES})-\\d{2,3}|white|black)(?:/|$)`
)

function spacingAllowed(match) {
  const [token, utility, value] = match
  if (SPACING_SCALE.has(value) || SPACING_NAMES.has(value)) return true
  return value === 'auto' && utility.startsWith('m') && !token.startsWith('-')
}

/** One rule per class family: the pattern, whether a match fails, and its message. */
const CLASS_RULES = [
  {
    pattern: PALETTE_CLASS,
    fails: () => true,
    message: (token) =>
      `Tailwind palette color \`${token}\`; use a token role (bg-page, text-ink)`,
  },
  {
    pattern: COLOR_UTILITY,
    // A palette class is reported once, by the rule above.
    fails: (match) =>
      !PALETTE_TOKEN.test(match[0]) && !colorUtilityAllowed(match[1], match[2]),
    message: (token) =>
      `\`${token}\` names no token color; it emits no CSS (use a role: bg-page, text-ink)`,
  },
  {
    pattern: ARBITRARY_COLOR,
    fails: () => true,
    message: (token) => `arbitrary color \`${token}...\`; use a token role`,
  },
  {
    pattern: DARK_COLOR,
    fails: () => true,
    message: (token) =>
      `\`${token}\` color variant; token roles follow the scheme on their own`,
  },
  {
    pattern: TEXT_SIZE,
    fails: () => true,
    message: (token) =>
      `type size \`${token}\` is off the D4 scale (text-xs to text-3xl)`,
  },
  {
    pattern: RADIUS_CLASS,
    fails: (match) => !RADIUS_SCALE.has(match[1] ?? ''),
    message: (token) =>
      `radius \`${token}\` is off D4 (rounded-sm, -md, -lg, -xl, -full, -none)`,
  },
  {
    pattern: SHADOW_CLASS,
    fails: (match) => !SHADOW_SCALE.has(match[1] ?? ''),
    message: (token) =>
      `shadow \`${token}\` is off D4 (shadow-none, shadow-card, shadow-overlay)`,
  },
  {
    pattern: SPACING_CLASS,
    spacing: true,
    fails: (match) => !spacingAllowed(match),
    message: (token) => `spacing \`${token}\` is off the D4 scale`,
  },
]

function classProblems(text, firstLine, { spacing }) {
  const problems = []
  for (const rule of CLASS_RULES) {
    if (rule.spacing && !spacing) continue
    for (const { match, line } of matches(rule.pattern, text, firstLine)) {
      if (rule.fails(match)) problems.push({ line, message: rule.message(match[0]) })
    }
  }
  return problems
}

function colorLiteralProblems(text, firstLine) {
  const problems = []
  for (const { match, line } of matches(HEX, text, firstLine))
    problems.push({
      line,
      message: `raw color \`${match[0]}\`; read it from the design tokens`,
    })
  for (const { match, line } of matches(RAW_FUNCTION, text, firstLine))
    problems.push({
      line,
      message: `raw color \`${match[0]}\`; read it from the design tokens`,
    })
  return problems
}

/**
 * D4 on native: a literal font size, corner radius or spacing value must be on the token scale
 * (`useTokens().type`, `.radius`, `.space`). Sizes (width, height, icon `size`) stay free.
 */
const NATIVE_SCALE =
  /\b(fontSize|borderRadius|border(?:Top|Bottom)(?:Left|Right|Start|End)Radius|padding(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|margin(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|gap|rowGap|columnGap)\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g
const NATIVE_FONT_SIZES = new Set([12, 14, 16, 18, 20, 24, 30])
const NATIVE_RADII = new Set([0, 4, 8, 12, 16, 9999])
const NATIVE_SPACE = new Set([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64])

function nativeScaleAllowed(property, value) {
  if (property === 'fontSize') return NATIVE_FONT_SIZES.has(value)
  if (property.endsWith('Radius')) return NATIVE_RADII.has(value)
  return NATIVE_SPACE.has(Math.abs(value))
}

function nativeScaleProblems(code, spacing) {
  const problems = []
  for (const { match, line } of matches(NATIVE_SCALE, code, 1)) {
    const [, property, raw] = match
    const isSpacing = !property.endsWith('Radius') && property !== 'fontSize'
    if (isSpacing && !spacing) continue
    if (!nativeScaleAllowed(property, Number(raw)))
      problems.push({
        line,
        message: `\`${match[0]}\` is off the D4 scale; use useTokens().type, .radius or .space`,
      })
  }
  return problems
}

/** Problems in one file's source, by app (`web` or `native`). */
export function checkSource(
  source,
  { app, relative, exemption = exemptionFor(relative) }
) {
  if (exemption?.rules === 'all') return []
  const spacing = exemption?.rules !== 'spacing'
  const problems = []
  if (relative.endsWith('.css')) {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, ' ')
    )
    problems.push(...colorLiteralProblems(text, 1))
    for (const { match, line } of matches(/@apply[^;]*;/g, text, 1))
      problems.push(...classProblems(match[0], line, { spacing }))
  } else {
    const { strings } = splitSource(source)
    for (const { text, line, interpolated } of strings) {
      problems.push(...colorLiteralProblems(text, line))
      if (app === 'web' && interpolated && INTERPOLATED_COLOR_UTILITY.test(text)) {
        const lastLine = line + (text.match(/\n/g)?.length ?? 0)
        problems.push({
          line: lastLine,
          message: `color class built at run time (\`${text.split(/\s/).at(-1)}\${...}\`); Tailwind emits no CSS for it, map the value to full class names`,
        })
      }
      if (app === 'web') problems.push(...classProblems(text, line, { spacing }))
    }
    {
      // Named colors need their style key or attribute, which lives in code: check the source
      // without comments, on both apps.
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const { match, line } of matches(NAMED_COLOR, withoutComments, 1))
        problems.push({
          line,
          message: `named color in \`${match[0]}\`; use a token role`,
        })
      if (app === 'native')
        problems.push(...nativeScaleProblems(withoutComments, spacing))
    }
  }
  return problems
    .sort((a, b) => a.line - b.line)
    .map((problem) => ({ file: relative, ...problem }))
}

function walk(root, directory, extensions, found) {
  const absolute = path.join(root, directory)
  if (!fs.existsSync(absolute)) return
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(root, child, extensions, found)
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      if (!TEST_FILE.test(child)) found.push(child)
    }
  }
}

/** Every scanned file under `root`, repo-relative, with its app. */
export function listFiles(root = REPOSITORY) {
  const web = []
  walk(root, WEB.root, WEB.extensions, web)
  const native = []
  for (const directory of NATIVE.roots) walk(root, directory, NATIVE.extensions, native)
  return [
    ...web.sort().map((relative) => ({ relative, app: 'web' })),
    ...native.sort().map((relative) => ({ relative, app: 'native' })),
  ]
}

function appFor(relative) {
  if (relative.startsWith(`${WEB.root}/`)) {
    return WEB.extensions.some((extension) => relative.endsWith(extension)) ? 'web' : null
  }
  if (NATIVE.roots.some((directory) => relative.startsWith(`${directory}/`))) {
    return NATIVE.extensions.some((extension) => relative.endsWith(extension))
      ? 'native'
      : null
  }
  return null
}

export function checkTree({ root = REPOSITORY, files } = {}) {
  const targets = files
    ? files
        .map((file) =>
          path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
        )
        .filter((relative) => !TEST_FILE.test(relative))
        .map((relative) => ({ relative, app: appFor(relative) }))
        .filter(({ app }) => app !== null)
    : listFiles(root)
  return targets.flatMap(({ relative, app }) =>
    checkSource(fs.readFileSync(path.join(root, relative), 'utf8'), { app, relative })
  )
}

function main(argv) {
  let root = REPOSITORY
  const files = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') {
      root = path.resolve(argv[index + 1])
      index += 1
    } else files.push(argv[index])
  }
  const problems = checkTree({ root, files: files.length ? files : undefined })
  for (const { file, line, message } of problems)
    console.error(`${file}:${line}: ${message}`)
  if (problems.length) {
    console.error(`\ncheck-design-tokens: ${problems.length} problem(s)`)
    return 1
  }
  console.log('check-design-tokens: clean')
  return 0
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2))
}
