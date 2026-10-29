/** Seed only the newly created simulator's Siri preferences before its first boot. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SIRI_DOMAIN = 'com.apple.assistant.support'
export const SIRI_KEYS = ['Assistant Enabled', 'Type To Siri Enabled']
const uuid = (value) =>
  /^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/.test(value)

export function seedOwnedSiriPreferences({
  device,
  directory,
  runtime,
  command,
  home = os.homedir(),
}) {
  if (
    !uuid(device) ||
    fs.readFileSync(path.join(directory, 'owned-startup-device.txt'), 'utf8').trim() !==
      device
  )
    throw new Error('owned_created_device_receipt_required')
  const binary = path.join(
    runtime.runtimeRoot,
    'System/Library/PrivateFrameworks/AssistantServices.framework/AssistantServices'
  )
  let source
  let sourceError = null
  try {
    source = fs.readFileSync(binary)
  } catch (error) {
    sourceError = { errorCode: error.code ?? null, errorMessage: error.message }
  }
  const supported = Boolean(
    source?.includes(Buffer.from(SIRI_DOMAIN)) &&
      SIRI_KEYS.every((key) => source.includes(Buffer.from(key)))
  )
  const record = {
    version: 1,
    device,
    runtime: {
      identifier: runtime.identifier,
      version: runtime.version,
      build: runtime.buildversion,
    },
    deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
    keysPresentInRuntime: supported,
    sourceError,
    changes: [],
    postBoot: [],
  }
  if (supported) {
    const domain = path.join(
      home,
      'Library/Developer/CoreSimulator/Devices',
      device,
      'data/Library/Preferences',
      SIRI_DOMAIN
    )
    fs.mkdirSync(path.dirname(domain), { recursive: true })
    for (const key of SIRI_KEYS) {
      const before = command(
        'siri-pref-before',
        '/usr/bin/defaults',
        ['read', domain, key],
        { fatal: false, timeout: 5000 }
      )
      const write = command(
        'siri-pref-disable',
        '/usr/bin/defaults',
        ['write', domain, key, '-bool', 'false'],
        { fatal: false, timeout: 5000 }
      )
      const after = command(
        'siri-pref-after',
        '/usr/bin/defaults',
        ['read', domain, key],
        { fatal: false, timeout: 5000 }
      )
      record.changes.push({
        key,
        before: before.exitCode === 0 ? before.stdout.trim() : null,
        writeExitCode: write.exitCode,
        after: after.exitCode === 0 ? after.stdout.trim() : null,
        confirmedFalse:
          write.exitCode === 0 && after.exitCode === 0 && after.stdout.trim() === '0',
      })
    }
  }
  const save = () =>
    fs.writeFileSync(
      path.join(directory, 'native-ios-siri-preferences.json'),
      JSON.stringify(record, null, 2) + '\n',
      { mode: 0o600 }
    )
  save()
  return () => {
    for (const key of SIRI_KEYS) {
      const read = command(
        'siri-pref-postboot',
        'xcrun',
        ['simctl', 'spawn', device, 'defaults', 'read', SIRI_DOMAIN, key],
        { fatal: false, timeout: 5000 }
      )
      record.postBoot.push({
        key,
        exitCode: read.exitCode,
        value: read.exitCode === 0 ? read.stdout.trim() : null,
        confirmedFalse: read.exitCode === 0 && read.stdout.trim() === '0',
      })
    }
    save()
  }
}
