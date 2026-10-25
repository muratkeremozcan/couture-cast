/**
 * Story 6.7b R18: Android flows grant Expo Go's permissions by name, so Maestro
 * skips its APK pull.
 *
 * A `launchApp` without `permissions:` means `permissions: { all: allow }` to
 * Maestro, and on Android that runs `AndroidDriver.setAllPermissions` (Maestro
 * 2.8.0): it pulls the app's whole `base.apk` over adb into a temp file only to
 * read the `<uses-permission>` names, then runs one `pm grant` per name. Expo Go's
 * APK is 186 MB, so every launch moved 186 MB through adb for a list of 55 names.
 *
 * Elimination puts the launch stalls in that transfer. In CI run 40145652214
 * (shard 1, `community-comments.yaml`) the device finished `pm clear` within about
 * 60 ms of Maestro's "Clearing app state" (its keystore namespace clear and the
 * PACKAGE_DATA_CLEARED broadcast are both logged), then sat idle, and Maestro's
 * first logged grant came 119 s after the clear began, against a median of 2.0 s
 * and a maximum of 3.9 s in the other 365 clear-state launches with a debug log in
 * runs 40045496619 to 40145652214. Between the two, Maestro runs only one short
 * `pm list packages -f` and the pull. Runs 40048980057, 40067302049, 40081299288
 * and 40100370340 each lost a 360 s attempt in a `launchApp`, one of them with no
 * `clearState` at all, so the step all five stalls share is the permission
 * lookup. Locally the same pull takes 7 to 33 s per launch.
 *
 * The runner reads the requested permissions once from `dumpsys package`, then
 * hands Maestro copies of the flows whose permission-less `launchApp` commands
 * name each of them with `allow`. Maestro then runs the same `pm grant` calls
 * it ran before, without the pull. iOS flows are untouched: the iOS driver grants
 * through the simulator.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The characters Maestro keeps in a permission name it is given by name. */
const PERMISSION_NAME = /^[A-Za-z0-9._]+$/

const LAUNCH_APP = /^(\s*)-\s+launchApp:\s*(#.*)?$/
const LAUNCH_APP_OTHER_FORM = /^\s*-\s+launchApp\b(?!:\s*(#.*)?$)/
const SET_PERMISSIONS = /^\s*-\s+setPermissions\b/

/**
 * The permissions `dumpsys package <appId>` lists as requested, in its order.
 * These are the manifest's `<uses-permission>` entries, the same names Maestro
 * reads from the pulled APK. Throws when the block is missing or empty, or when a
 * name has characters Maestro would strip from a name it is given.
 *
 * @param {string} dumpsysOutput
 * @param {string} appId for the error message
 * @returns {string[]}
 */
export function requestedPermissionsFromDumpsys(dumpsysOutput, appId) {
  const lines = dumpsysOutput.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s*requested permissions:\s*$/.test(line))
  if (start < 0) {
    throw new Error(`dumpsys package ${appId} lists no requested permissions block`)
  }
  const indent = (line) => line.length - line.trimStart().length
  const blockIndent = indent(lines[start])
  const permissions = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || indent(line) <= blockIndent) break
    // Newer releases append flags: `android.permission.X: restricted=true`.
    const name = line.trim().split(':')[0].trim()
    if (!PERMISSION_NAME.test(name)) {
      throw new Error(
        `dumpsys package ${appId} lists a permission Maestro cannot grant by name: ${name}`
      )
    }
    if (!permissions.includes(name)) permissions.push(name)
  }
  if (permissions.length === 0) {
    throw new Error(`dumpsys package ${appId} lists an empty requested permissions block`)
  }
  return permissions
}

/**
 * Gives every `launchApp` mapping that has no `permissions:` key an explicit
 * `permissions:` block naming each of `permissions` with `allow`, inserted as
 * the mapping's first key. A `launchApp` that already names its permissions is
 * left as written. Throws, naming the file and line, for anything that would
 * still make Maestro pull the APK (`all:` under `permissions:`, a
 * `setPermissions` command) and for a `launchApp` form this cannot rewrite, so a
 * new flow cannot bring the pull back unnoticed.
 *
 * @param {string} yamlText
 * @param {readonly string[]} permissions
 * @param {string} label the file, for error messages
 * @returns {{ text: string, rewritten: number }}
 */
export function withExplicitLaunchPermissions(yamlText, permissions, label) {
  const lines = yamlText.split('\n')
  const output = []
  let rewritten = 0
  const indent = (line) => line.length - line.trimStart().length
  const isContent = (line) => line.trim() !== '' && !line.trimStart().startsWith('#')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const where = `${label}:${index + 1}`
    if (SET_PERMISSIONS.test(line)) {
      throw new Error(`${where}: setPermissions would make Maestro pull the APK`)
    }
    if (LAUNCH_APP_OTHER_FORM.test(line)) {
      throw new Error(
        `${where}: write launchApp as a mapping so its permissions can be named`
      )
    }
    const match = LAUNCH_APP.exec(line)
    output.push(line)
    if (!match) continue
    const keyIndent = match[1].length + 2
    let end = index + 1
    while (
      end < lines.length &&
      (!isContent(lines[end]) || indent(lines[end]) > keyIndent)
    ) {
      end += 1
    }
    const body = lines.slice(index + 1, end).filter(isContent)
    if (body.length === 0) {
      throw new Error(`${where}: launchApp has no keys; give it an appId mapping`)
    }
    const bodyIndent = indent(body[0])
    const keys = body.filter((entry) => indent(entry) === bodyIndent)
    const permissionsKey = keys.find((entry) => /^\s*permissions:/.test(entry))
    if (permissionsKey) {
      const after = body.slice(body.indexOf(permissionsKey) + 1)
      const blockEnd = after.findIndex((entry) => indent(entry) <= bodyIndent)
      const entries = blockEnd < 0 ? after : after.slice(0, blockEnd)
      if (entries.some((entry) => /^\s*['"]?all['"]?\s*:/.test(entry))) {
        throw new Error(`${where}: permissions.all would make Maestro pull the APK`)
      }
      continue
    }
    const pad = ' '.repeat(bodyIndent)
    output.push(
      `${pad}# Runner: Expo Go's requested permissions, named (Story 6.7b R18).`
    )
    output.push(`${pad}permissions:`)
    for (const name of permissions) output.push(`${pad}  ${name}: allow`)
    rewritten += 1
  }
  return { text: output.join('\n'), rewritten }
}

/**
 * Copies the flow tree at `sourceDir` to `targetDir`, rewriting every `.yaml`
 * and `.yml` file with {@link withExplicitLaunchPermissions}. Directories named
 * in `skip` (Maestro's artifact output) are not copied. Subflows, scripts and
 * media keep their relative paths, so a copied flow resolves them in the copy.
 *
 * @param {{
 *   sourceDir: string,
 *   targetDir: string,
 *   permissions: readonly string[],
 *   skip?: readonly string[],
 * }} options
 * @returns {{ files: number, rewritten: number }}
 */
export function prepareAndroidFlowTree({ sourceDir, targetDir, permissions, skip = [] }) {
  fs.rmSync(targetDir, { recursive: true, force: true })
  let files = 0
  let rewritten = 0
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isDirectory()) {
        if (from === sourceDir && skip.includes(entry.name)) continue
        // The copy may live inside the tree it copies (under the artifact output).
        if (path.resolve(source) === path.resolve(targetDir)) continue
        copy(source, target)
      } else if (/\.ya?ml$/.test(entry.name)) {
        const result = withExplicitLaunchPermissions(
          fs.readFileSync(source, 'utf8'),
          permissions,
          path.relative(path.dirname(sourceDir), source)
        )
        fs.writeFileSync(target, result.text)
        files += 1
        rewritten += result.rewritten
      } else if (entry.isFile()) {
        fs.copyFileSync(source, target)
      }
    }
  }
  copy(sourceDir, targetDir)
  return { files, rewritten }
}

/**
 * Where `flowPath`, a flow under `sourceDir`, sits in the prepared copy.
 * Throws for a flow outside `sourceDir`, which the copy does not hold.
 *
 * @param {string} flowPath
 * @param {string} sourceDir
 * @param {string} targetDir
 * @returns {string}
 */
export function preparedFlowPath(flowPath, sourceDir, targetDir) {
  const relative = path.relative(path.resolve(sourceDir), path.resolve(flowPath))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${flowPath} is outside ${sourceDir}, so it has no prepared copy`)
  }
  return path.join(targetDir, relative)
}
