/**
 * Story 6.7b R18: Android flows reach Maestro with Expo Go's permissions named,
 * so Maestro grants them without pulling the 186 MB APK over adb. See
 * scripts/lib/maestro-android-permissions.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import {
  preparedFlowPath,
  prepareAndroidFlowTree,
  requestedPermissionsFromDumpsys,
  withExplicitLaunchPermissions,
} from '../../../scripts/lib/maestro-android-permissions.mjs'

const DUMPSYS = `Packages:
  Package [host.exp.exponent] (5d3f1a2):
    userId=10192
    requested permissions:
      android.permission.WRITE_SETTINGS
      android.permission.CAMERA
      android.permission.ACCESS_FINE_LOCATION: restricted=true
      android.permission.CAMERA
    install permissions:
      android.permission.INTERNET: granted=true
`
const PERMISSIONS = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO']

type Command = Record<string, unknown>

/** Every `launchApp` argument in a flow file, nested commands included. */
function launchApps(yamlText: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Command)) {
        if (key === 'launchApp') found.push(inner as Record<string, unknown>)
        walk(inner)
      }
    }
  }
  for (const document of parseAllDocuments(yamlText)) walk(document.toJS())
  return found
}

function yamlFiles(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}artifacts${path.sep}`))
}

let directory: string | undefined
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('requested permissions from dumpsys', () => {
  it('6.7b-R18-01 reads the requested block in order, without flags or repeats', () => {
    expect(requestedPermissionsFromDumpsys(DUMPSYS, 'host.exp.exponent')).toEqual([
      'android.permission.WRITE_SETTINGS',
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
    ])
  })

  it('6.7b-R18-02 refuses output with no block, an empty block or an ungrantable name', () => {
    expect(() => requestedPermissionsFromDumpsys('Unable to find package', 'x')).toThrow(
      'lists no requested permissions block'
    )
    expect(() =>
      requestedPermissionsFromDumpsys(
        '    requested permissions:\n    install permissions:\n',
        'x'
      )
    ).toThrow('empty requested permissions block')
    expect(() =>
      requestedPermissionsFromDumpsys(
        '    requested permissions:\n      com.example.permission/BAD\n',
        'x'
      )
    ).toThrow('Maestro cannot grant by name: com.example.permission/BAD')
  })
})

describe('explicit launchApp permissions', () => {
  it('6.7b-R18-03 names every permission on a launchApp that names none, nested ones too', () => {
    const flow = `appId: host.exp.exponent
---
- launchApp:
    appId: \${MAESTRO_APP_ID}
    clearState: true
    stopApp: false

- repeat:
    times: 2
    commands:
      - launchApp:
          # relaunch
          appId: \${MAESTRO_APP_ID}
      - tapOn: Home
`
    const { text, rewritten } = withExplicitLaunchPermissions(flow, PERMISSIONS, 'f.yaml')
    expect(rewritten).toBe(2)
    const launches = launchApps(text)
    expect(launches).toHaveLength(2)
    for (const launch of launches) {
      expect(launch.permissions).toEqual({
        'android.permission.CAMERA': 'allow',
        'android.permission.RECORD_AUDIO': 'allow',
      })
    }
    expect(launches[0]).toMatchObject({ clearState: true, stopApp: false })
  })

  it('6.7b-R18-04 leaves a launchApp that names its own permissions as written', () => {
    const flow = `- launchApp:
    appId: app
    permissions:
      camera: allow
      photos: allow
- tapOn: Next
`
    expect(withExplicitLaunchPermissions(flow, PERMISSIONS, 'f.yaml')).toEqual({
      text: flow,
      rewritten: 0,
    })
  })

  it('6.7b-R18-05 refuses every form that would still pull the APK or cannot be rewritten', () => {
    const refuse = (flow: string, message: string) =>
      expect(() => withExplicitLaunchPermissions(flow, PERMISSIONS, 'f.yaml')).toThrow(
        message
      )
    refuse(
      '- launchApp:\n    appId: app\n    permissions:\n      all: deny\n',
      'f.yaml:1: permissions.all would make Maestro pull the APK'
    )
    refuse(
      '- tapOn: A\n- setPermissions:\n    permissions:\n      all: allow\n',
      'f.yaml:2: setPermissions would make Maestro pull the APK'
    )
    refuse('- launchApp\n', 'f.yaml:1: write launchApp as a mapping')
    refuse('- launchApp: { appId: app }\n', 'f.yaml:1: write launchApp as a mapping')
    refuse('- launchApp:\n- tapOn: A\n', 'f.yaml:1: launchApp has no keys')
  })
})

describe('prepared Android flow tree', () => {
  it('6.7b-R18-06 copies the tree with subflows and scripts, rewritten, and skips artifacts', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r18-flows-'))
    const source = path.join(directory, 'maestro')
    fs.mkdirSync(path.join(source, 'subflows'), { recursive: true })
    fs.mkdirSync(path.join(source, 'artifacts'), { recursive: true })
    fs.writeFileSync(
      path.join(source, 'flow.yaml'),
      'appId: a\n---\n- launchApp:\n    appId: a\n- runFlow: subflows/relaunch.yaml\n'
    )
    fs.writeFileSync(
      path.join(source, 'subflows', 'relaunch.yaml'),
      'appId: a\n---\n- launchApp:\n    appId: a\n    stopApp: true\n'
    )
    fs.writeFileSync(path.join(source, 'subflows', 'open.js'), 'output.ok = true\n')
    fs.writeFileSync(path.join(source, 'artifacts', 'old.yaml'), '- launchApp\n')
    const target = path.join(directory, 'prepared')

    expect(
      prepareAndroidFlowTree({
        sourceDir: source,
        targetDir: target,
        permissions: PERMISSIONS,
        skip: ['artifacts'],
      })
    ).toEqual({ files: 2, rewritten: 2 })
    expect(fs.existsSync(path.join(target, 'artifacts'))).toBe(false)
    expect(fs.readFileSync(path.join(target, 'subflows', 'open.js'), 'utf8')).toBe(
      'output.ok = true\n'
    )
    expect(
      launchApps(
        fs.readFileSync(path.join(target, 'subflows', 'relaunch.yaml'), 'utf8')
      )[0]
    ).toMatchObject({
      stopApp: true,
      permissions: { 'android.permission.CAMERA': 'allow' },
    })
    expect(preparedFlowPath(path.join(source, 'flow.yaml'), source, target)).toBe(
      path.join(target, 'flow.yaml')
    )
    expect(() => preparedFlowPath('/elsewhere/flow.yaml', source, target)).toThrow(
      'has no prepared copy'
    )
  })

  it('6.7b-R18-07 leaves no repo launchApp for Maestro to resolve by pulling the APK', () => {
    // The repo's own flows rely on the default `all: allow`, which is the pull.
    const permissionless = (root: string) =>
      yamlFiles(root).flatMap((file) =>
        launchApps(fs.readFileSync(file, 'utf8'))
          .filter((launch) => !launch.permissions)
          .map(() => path.relative(root, file))
      )
    expect(permissionless('maestro').length).toBeGreaterThan(20)

    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r18-repo-flows-'))
    const { rewritten } = prepareAndroidFlowTree({
      sourceDir: 'maestro',
      targetDir: directory,
      permissions: PERMISSIONS,
      skip: ['artifacts'],
    })
    expect(rewritten).toBe(permissionless('maestro').length)
    expect(permissionless(directory)).toEqual([])
  })
})
