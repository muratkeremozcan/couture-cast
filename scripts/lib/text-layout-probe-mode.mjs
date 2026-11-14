// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: a native build must link the text layout probe exactly when it was asked for.
// apps/mobile/plugins/with-text-layout-probe.js writes the exclusion into the generated
// android/settings.gradle and ios/Podfile unless COUTURE_TEXT_LAYOUT_PROBE=1 at prebuild, and a
// build reuses whatever project the last prebuild left. A probe build over a production project
// (or the reverse) once built silently, so scripts/run-story68-native.mjs checks the generated
// project against the requested mode after it prebuilds and before it builds. On iOS the Podfile
// only says what the next pod install links: xcodebuild compiles what the last one installed, so
// after pod install and before every iOS build Podfile.lock and the Pods project must agree too.
import fs from 'node:fs'
import path from 'node:path'

const MODULE = 'text-layout-probe'
/** The pod the module's podspec names, as Podfile.lock and the Pods project list it. */
const POD = 'TextLayoutProbe'

/** The generated file that carries each platform's exclusion, relative to apps/mobile. */
export const PROBE_MODE_FILES = Object.freeze({
  android: 'android/settings.gradle',
  ios: 'ios/Podfile',
})

/** What the last pod install left, relative to apps/mobile. */
export const IOS_POD_FILES = Object.freeze({
  lock: 'ios/Podfile.lock',
  project: 'ios/Pods/Pods.xcodeproj/project.pbxproj',
})

/** The mode the environment asks for: the probe only with COUTURE_TEXT_LAYOUT_PROBE=1. */
export const requestedProbeMode = (env) =>
  env.COUTURE_TEXT_LAYOUT_PROBE === '1' ? 'probe' : 'production'

const QUOTED = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g

/** Each line with its comment cut off: from the first marker that is outside a string. */
function withoutComments(contents, marker) {
  const lines = contents
    .replace(marker === '//' ? /\/\*[\s\S]*?\*\//g : /$^/, '')
    .split('\n')
  return lines
    .map((line) => {
      let quote = null
      for (let at = 0; at < line.length; at += 1) {
        const char = line[at]
        if (quote) {
          if (char === '\\') at += 1
          else if (char === quote) quote = null
        } else if (char === "'" || char === '"') quote = char
        else if (line.startsWith(marker, at)) return line.slice(0, at)
      }
      return line
    })
    .join('\n')
}

/** The text from `open` at `from` to its matching close, strings skipped; to the end if unclosed. */
function balanced(code, from, open, close) {
  let depth = 0
  let quote = null
  for (let at = from; at < code.length; at += 1) {
    const char = code[at]
    if (quote) {
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"') quote = char
    else if (char === open) depth += 1
    else if (char === close && --depth === 0) return code.slice(from, at + 1)
  }
  return code.slice(from)
}

/** The statement from `from` to the first line end outside brackets and strings. */
function statement(code, from) {
  let depth = 0
  let quote = null
  for (let at = from; at < code.length; at += 1) {
    const char = code[at]
    if (quote) {
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"') quote = char
    else if (char === '[' || char === '(') depth += 1
    else if (char === ']' || char === ')') depth -= 1
    else if (char === '\n' && depth <= 0) return code.slice(from, at)
  }
  return code.slice(from)
}

/** The string literals inside every [...] list in `code`. */
function listedStrings(code) {
  const strings = []
  for (let at = code.indexOf('['); at >= 0; at = code.indexOf('[', at + 1)) {
    const list = balanced(code, at, '[', ']')
    for (const match of list.matchAll(QUOTED)) strings.push(match[2])
    at += list.length - 1
  }
  return strings
}

/**
 * The modules each `use_expo_modules!` call in a Podfile excludes, comments ignored, quotes of
 * either kind, its arguments in parentheses or bare, the list over one line or several.
 */
export function podfileExclusions(contents) {
  const code = withoutComments(contents, '#')
  const calls = []
  for (const match of code.matchAll(/\buse_expo_modules!/g)) {
    const after = match.index + match[0].length
    const rest = code.slice(after)
    const args = /^\s*\(/.test(rest)
      ? balanced(code, after + rest.indexOf('('), '(', ')')
      : rest.split('\n')[0]
    const key = /(?:\bexclude:|:exclude\s*=>)\s*/.exec(args)
    const start = key ? args.indexOf('[', key.index) : -1
    calls.push(start >= 0 ? listedStrings(balanced(args, start, '[', ']')) : [])
  }
  return calls
}

/**
 * The modules settings.gradle leaves excluded: each `expoAutolinking.exclude` assignment in
 * order, comments ignored, quotes of either kind. `=` replaces the list unless its right side
 * reads the list back (`(expoAutolinking.exclude ?: []) + [...]`); `+=` adds to it.
 */
export function settingsGradleExclusions(contents) {
  const code = withoutComments(contents, '//')
  let excluded = new Set()
  for (const match of code.matchAll(/\bexpoAutolinking\.exclude\s*(\+?=)(?!=)/g)) {
    const rhs = statement(code, match.index + match[0].length)
    const keeps = match[1] === '+=' || /\bexpoAutolinking\.exclude\b/.test(rhs)
    excluded = new Set([...(keeps ? excluded : []), ...listedStrings(rhs)])
  }
  return [...excluded]
}

/** The mode a generated project builds: production when it excludes the probe, else probe. */
export function generatedProbeMode(platform, contents) {
  if (platform === 'android')
    return settingsGradleExclusions(contents).includes(MODULE) ? 'production' : 'probe'
  if (platform === 'ios') {
    const calls = podfileExclusions(contents)
    return calls.length > 0 && calls.every((excluded) => excluded.includes(MODULE))
      ? 'production'
      : 'probe'
  }
  throw new Error('native_build_platform_required')
}

/** The pods Podfile.lock lists under PODS, subspecs folded into their pod. */
export function podfileLockPods(contents) {
  const pods = new Set()
  let inPods = false
  for (const line of contents.split('\n')) {
    if (/^\S/.test(line)) inPods = line.trim() === 'PODS:'
    else if (inPods) {
      const entry = /^ {2}- "?([^\s"(/:]+)/.exec(line)
      if (entry) pods.add(entry[1])
    }
  }
  return [...pods]
}

/** The native targets of a Pods project (project.pbxproj). */
export function podsProjectTargets(contents) {
  return [
    ...contents.matchAll(/\bisa = PBXNativeTarget;[\s\S]*?\bname = ("?)([^";\n]+)\1;/g),
  ].map((match) => match[2])
}

const mismatch = (platform, file, generated, requested) =>
  `native_probe_mode_mismatch:${platform}:${file ? `${file}:` : ''}${generated}_project:${requested}_requested`

/** A coded problem when the generated project and the requested mode disagree, else null. */
export function probeModeProblem({ platform, contents, env }) {
  if (contents === undefined || contents === null)
    return `native_probe_mode_project_missing:${platform}`
  const generated = generatedProbeMode(platform, contents)
  const requested = requestedProbeMode(env)
  return generated === requested ? null : mismatch(platform, null, generated, requested)
}

/**
 * A coded problem when what pod install left disagrees with the requested mode: the probe pod
 * in Podfile.lock and as a Pods project target only in probe mode. Null when both agree.
 */
export function podsProbeModeProblem({ lock, project, env }) {
  const requested = requestedProbeMode(env)
  const files = [
    [path.basename(IOS_POD_FILES.lock), lock, podfileLockPods],
    [path.basename(path.dirname(IOS_POD_FILES.project)), project, podsProjectTargets],
  ]
  for (const [name, contents, listed] of files) {
    if (contents === undefined || contents === null)
      return `native_probe_mode_project_missing:ios:${name}`
    const generated = listed(contents).includes(POD) ? 'probe' : 'production'
    if (generated !== requested) return mismatch('ios', name, generated, requested)
  }
  return null
}

const readIfPresent = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}

/**
 * Throws the coded problem for the generated project under apps/mobile, if any. On iOS it also
 * checks what pod install left, unless `pods` is false: only the check right before pod install
 * passes that, since that install is what brings the Pods in line with the Podfile.
 */
export function assertNativeProbeMode({ platform, mobileDirectory, env, pods = true }) {
  const file = PROBE_MODE_FILES[platform]
  if (!file) throw new Error('native_build_platform_required')
  const problem =
    probeModeProblem({
      platform,
      contents: readIfPresent(path.join(mobileDirectory, file)),
      env,
    }) ??
    (platform === 'ios' && pods
      ? podsProbeModeProblem({
          lock: readIfPresent(path.join(mobileDirectory, IOS_POD_FILES.lock)),
          project: readIfPresent(path.join(mobileDirectory, IOS_POD_FILES.project)),
          env,
        })
      : null)
  if (problem) throw new Error(problem)
}
