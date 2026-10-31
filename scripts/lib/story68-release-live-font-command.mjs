import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { restoreAndroidReverse } from './story68-native-safety.mjs'
import { proveReleaseLiveFont } from './story68-release-live-font.mjs'

const failures = new Set([
  'owned_uuid_loopback_database_required',
  'pinned_owned_native_runtime_required',
  'effective_owned_api_database_proof_required',
  'owned_release_font_target_required',
  'owned_release_font_auth_required',
  'owned_avd_and_safe_even_port_required',
  'owned_release_api36_required',
  'non_debuggable_release_required',
  'installed_release_apk_required',
  'installed_release_apk_mismatch',
  'release_font_catalog_required',
  'release_font_native_command_failed',
  'release_font_hierarchy_invalid',
  'release_title_bounds_required',
  'release_error_surface',
  'release_production_preview_required',
  'release_localized_title_required',
  'release_watermark_off_required',
  'release_full_render_label_required',
  'release_process_changed',
  'release_process_required',
  'release_crash_log',
  'release_text_nodes_changed',
  'release_font_restore_failed',
  'release_restore_deadline',
  'release_applied_font_configuration_required',
  'release_stable_state_required',
])

export async function runReleaseLiveFontCommand(ctx) {
  const file = 'native-release-live-font-android.json'
  ctx.privateJson(file, { platform: 'android', configuration: 'Release', passed: false })
  const privateFile = (name, data) =>
    fs.writeFileSync(path.join(ctx.directory, name), data, { mode: 0o600 })
  const execute = (binary, args, timeout = 10000, binaryOutput = false) => {
    const started = performance.now()
    const result = spawnSync(binary, args, {
      cwd: ctx.root,
      encoding: binaryOutput ? undefined : 'utf8',
      timeout: Math.max(1, Math.ceil(timeout)),
      killSignal: 'SIGKILL',
      detached: true,
      maxBuffer: 30 * 1024 * 1024,
    })
    if (result.error?.code === 'ETIMEDOUT' && result.pid) {
      try {
        process.kill(-result.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    if (result.error || result.status !== 0) {
      privateFile(
        'release-live-font-command-error-private.log',
        JSON.stringify(
          {
            binary,
            args,
            timeoutMs: Math.max(1, Math.ceil(timeout)),
            durationMs: Math.ceil(performance.now() - started),
            status: result.status ?? null,
            signal: result.signal ?? null,
            error: result.error
              ? {
                  code: result.error.code ?? null,
                  message: result.error.message ?? null,
                }
              : null,
            stdout: result.stdout?.toString() ?? '',
            stderr: result.stderr?.toString() ?? '',
          },
          null,
          2
        )
      )
      throw new Error('release_font_native_command_failed')
    }
    return result.stdout
  }
  const adb = (args, binaryOutput = false) =>
    execute(ctx.adb, ['-s', ctx.device, ...args], 10000, binaryOutput)
  try {
    // These exact files belong to this command's current attempt. Removing them
    // before guards prevents an early failure from exposing a prior tree or PNG.
    for (const name of [
      'release-live-font-before-private.json',
      'release-live-font-after-private.json',
      'release-live-font-before-private.png',
      'release-live-font-after-private.png',
      'release-live-font-logcat-private.log',
      'release-live-font-command-error-private.log',
    ])
      fs.rmSync(path.join(ctx.directory, name), { force: true })
    const result = await proveReleaseLiveFont(
      {
        platform: ctx.platform,
        appId: ctx.appId,
        device: ctx.device,
        apkSha256: createHash('sha256')
          .update(fs.readFileSync(ctx.apkPath))
          .digest('hex'),
        runtime: {
          environment: ctx.read('owned-env.json'),
          build: ctx.read('public-build-env.json'),
          resources: ctx.read('resources.json'),
          apiLog: fs.readFileSync(path.join(ctx.directory, 'api.log'), 'utf8'),
        },
        clientCatalog: JSON.parse(
          fs.readFileSync(
            path.join(ctx.root, 'apps/mobile/assets/locales/en-US.json'),
            'utf8'
          )
        ),
        renderCatalog: JSON.parse(
          fs.readFileSync(
            path.join(ctx.root, 'apps/api/src/modules/share-cards/assets/en-US.json'),
            'utf8'
          )
        ),
      },
      {
        avdName: () => adb(['emu', 'avd', 'name']),
        shell: (args, timeout = 10000) =>
          execute(ctx.adb, ['-s', ctx.device, 'shell', ...args], timeout),
        connect: () =>
          restoreAndroidReverse({
            adb: ctx.adb,
            device: ctx.device,
            ports: [4088, 53068, 54321],
          }),
        maestro: ctx.maestro,
        hierarchy: (timeout) => {
          const raw = execute(
            ctx.maestroBinary,
            ['--device', ctx.device, 'hierarchy', '--no-reinstall-driver'],
            timeout
          )
          try {
            return JSON.parse(raw)
          } catch {
            throw new Error('release_font_hierarchy_invalid')
          }
        },
        recordTree: (stage, value) =>
          privateFile(
            `release-live-font-${stage}-private.json`,
            JSON.stringify(value, null, 2)
          ),
        logcat: (pid) => adb(['logcat', '-d', '--pid', pid, '-v', 'threadtime']),
        recordLog: (value) => privateFile('release-live-font-logcat-private.log', value),
        screenshot: (stage = 'after') =>
          privateFile(
            `release-live-font-${stage}-private.png`,
            adb(['exec-out', 'screencap', '-p'], true)
          ),
      }
    )
    ctx.privateJson(file, result)
    console.log(
      'Native Android Release live-font state and full text-preservation proof passed.'
    )
    return result
  } catch (error) {
    const code = failures.has(error?.message) ? error.message : 'release_live_font_failed'
    ctx.privateJson(file, {
      platform: 'android',
      configuration: 'Release',
      passed: false,
      code,
    })
    // The closed code reaches the job log; the trees, logs and command output stay private.
    console.log(JSON.stringify({ releaseLiveFont: { passed: false, code } }))
    throw error
  }
}
