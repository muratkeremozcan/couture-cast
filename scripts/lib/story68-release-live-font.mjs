import { assertRapidWatermarkRuntime } from './story68-rapid-watermark.mjs'
import { assertOwnedStory68EmulatorPort } from './story68-native-safety.mjs'

const app = 'com.couturecast.story68'
const timeoutMs = 20_000
const fail = (code) => {
  throw new Error(code)
}
function matches(tree, id) {
  return [
    ...(tree.attributes?.['resource-id'] === id ? [tree.attributes] : []),
    ...(tree.children ?? []).flatMap((child) => matches(child, id)),
  ]
}
function nodes(tree) {
  return [tree.attributes ?? {}, ...(tree.children ?? []).flatMap(nodes)]
}
function textIdentities(tree) {
  return nodes(tree)
    .filter(
      (node) => node.text && !/^com\.android\.systemui:/.test(node['resource-id'] ?? '')
    )
    .map((node) =>
      JSON.stringify([
        node['resource-id'] ?? '',
        node.class ?? '',
        node.text,
        node.accessibilityText ?? '',
      ])
    )
    .sort()
}
/** Compare the full text multiset. Bounds may change during native font layout. */
export function assertReleaseTextPreserved(before, after) {
  const baseline = textIdentities(before)
  const current = textIdentities(after)
  if (!baseline.length || JSON.stringify(baseline) !== JSON.stringify(current))
    fail('release_text_nodes_changed')
  return {
    beforeTextNodes: baseline.length,
    afterTextNodes: current.length,
    textNodesPreserved: true,
  }
}
function height(bounds) {
  const coordinates = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? '')
  if (!coordinates) fail('release_title_bounds_required')
  const [, left, top, right, bottom] = coordinates.map(Number)
  if (right <= left || bottom <= top) fail('release_title_bounds_required')
  return bottom - top
}
function noErrorSurface(tree) {
  return !nodes(tree).some(
    (node) =>
      /hero-error-state|share-card-error|logbox/i.test(node['resource-id'] ?? '') ||
      /configured linking in multiple|uncaught error|typeerror:|referenceerror:/i.test(
        `${node.text ?? ''} ${node.accessibilityText ?? ''}`
      )
  )
}
function releaseState(tree, expected) {
  if (!noErrorSurface(tree)) fail('release_error_surface')
  const title = matches(tree, 'share-card-title')
  const preview = matches(tree, 'share-card-preview-loaded')
  const watermark = matches(tree, 'share-card-watermark')
  if (
    title.length !== 1 ||
    preview.length !== 1 ||
    nodes(tree).some((node) =>
      /^share-card-preview-loaded-/.test(node['resource-id'] ?? '')
    )
  )
    fail('release_production_preview_required')
  if (![title[0].text, title[0].accessibilityText].includes(expected.title))
    fail('release_localized_title_required')
  if (watermark.length !== 1 || ![false, 'false'].includes(watermark[0].checked))
    fail('release_watermark_off_required')
  if (![preview[0].text, preview[0].accessibilityText].includes(expected.label))
    fail('release_full_render_label_required')
  return { titleHeight: height(title[0].bounds) }
}
function assertTarget(config) {
  assertRapidWatermarkRuntime(config.runtime)
  if (
    config.platform !== 'android' ||
    config.appId !== app ||
    !/^emulator-\d{4}$/.test(config.device ?? '') ||
    !/^[a-f0-9]{64}$/.test(config.apkSha256 ?? '')
  )
    fail('owned_release_font_target_required')
  const upstreamAuth = new URL(config.runtime.environment.SUPABASE_URL)
  if (
    !['http:', 'https:'].includes(upstreamAuth.protocol) ||
    !['localhost', '127.0.0.1'].includes(upstreamAuth.hostname)
  )
    fail('owned_release_font_auth_required')
  const auth = new URL(config.runtime.build.EXPO_PUBLIC_SUPABASE_URL)
  if (
    !['http:', 'https:'].includes(auth.protocol) ||
    !['localhost', '127.0.0.1'].includes(auth.hostname) ||
    Number(auth.port) !== 53068 ||
    config.runtime.resources.authProxyPort !== 53068
  )
    fail('owned_release_font_auth_required')
}
async function guardInstalledRelease(config, io) {
  const avd = (await io.avdName()).split('\n')[0].trim()
  assertOwnedStory68EmulatorPort({ avd, port: config.device.slice('emulator-'.length) })
  if (
    avd !== 'cc68-api36' ||
    (await io.shell(['getprop', 'ro.build.version.sdk'])).trim() !== '36'
  )
    fail('owned_release_api36_required')
  const dump = await io.shell(['dumpsys', 'package', app])
  if (
    !dump.includes(`Package [${app}]`) ||
    !/^\s*(?:pkgFlags|flags)=\[[^\]]*\]/m.test(dump) ||
    /\bDEBUGGABLE\b/.test(dump)
  )
    fail('non_debuggable_release_required')
  const installed = (await io.shell(['pm', 'path', app])).trim()
  const file = /^package:(\/data\/app\/[A-Za-z0-9_~+=./-]+\/base\.apk)$/.exec(
    installed
  )?.[1]
  if (!file) fail('installed_release_apk_required')
  const sha = (await io.shell(['toybox', 'sha256sum', file])).trim().split(/\s+/)[0]
  if (sha !== config.apkSha256) fail('installed_release_apk_mismatch')
}
function expectedState(config) {
  const client = config.clientCatalog
  const render = config.renderCatalog
  const values = [
    client.shareCard?.title,
    render.outfit,
    render.scenarios?.morning,
    ...['top', 'bottom', 'shoes'].map((category) => render.categories?.[category]),
  ]
  if (values.some((value) => typeof value !== 'string' || !value.trim()))
    fail('release_font_catalog_required')
  return { title: values[0], label: [...values.slice(1), 'CoutureCast'].join('. ') }
}
async function restoredState(
  io,
  expected,
  before,
  now = () => performance.now(),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  const deadline = now() + timeoutMs
  let lastFailure = new Error('release_production_preview_required')
  do {
    const tree = await io.hierarchy(Math.max(1, deadline - now()), 'after')
    await io.recordTree('after', tree)
    if (!noErrorSurface(tree)) fail('release_error_surface')
    if (now() > deadline) fail('release_restore_deadline')
    try {
      return {
        ...releaseState(tree, expected),
        ...assertReleaseTextPreserved(before, tree),
      }
    } catch (error) {
      lastFailure = error
    }
    if (now() < deadline) await pause(Math.min(100, deadline - now()))
  } while (now() < deadline)
  throw lastFailure
}

async function captureFailureEvidence(io, pid) {
  const collectors = [
    ...(pid ? [async () => io.recordLog(await io.logcat(pid))] : []),
    () => io.screenshot('after'),
  ]
  for (const collect of collectors) {
    try {
      await collect()
    } catch {
      // Each diagnostic is independent; preserve the original failed assertion.
    }
  }
}

/** The font changes live only between verified before/after production card states. */
export async function proveReleaseLiveFont(config, io) {
  assertTarget(config)
  const expected = expectedState(config)
  await guardInstalledRelease(config, io)
  await io.connect?.()
  const previous = (await io.shell(['settings', 'get', 'system', 'font_scale'])).trim()
  let restoreRequired = false
  let failed = false
  let failure
  let result
  let pid
  try {
    await io.shell(['am', 'force-stop', app])
    restoreRequired = true
    await io.shell(['settings', 'put', 'system', 'font_scale', '1.0'])
    await io.shell(['am', 'start', '-n', `${app}/.MainActivity`])
    await io.maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: 'en-US' })
    await io.maestro('maestro/story68/release-open-outfit.yaml')
    await io.maestro('maestro/story68/release-watermark-off.yaml')
    // The baseline verifies compatibility while retaining the driver for the
    // timed after capture. Default Maestro teardown would uninstall both APKs.
    const before = await io.hierarchy(timeoutMs, 'before')
    await io.recordTree('before', before)
    const baseline = releaseState(before, expected)
    await io.screenshot('before')
    pid = (await io.shell(['pidof', app])).trim()
    if (!/^\d+$/.test(pid)) fail('release_process_required')
    const priorLog = await io.logcat(pid)
    await io.shell(['settings', 'put', 'system', 'font_scale', '1.5'])
    const after = await restoredState(io, expected, before, io.now, io.pause)
    const log = await io.logcat(pid)
    await io.recordLog(log)
    await io.screenshot('after')
    if (
      /FATAL EXCEPTION|Fatal signal|Force finishing activity/i.test(
        log.startsWith(priorLog) ? log.slice(priorLog.length) : log
      )
    )
      fail('release_crash_log')
    if ((await io.shell(['pidof', app])).trim() !== pid) fail('release_process_changed')
    result = {
      platform: 'android',
      configuration: 'Release',
      debuggable: false,
      apkSha256: config.apkSha256,
      productionPreview: true,
      localizedTitle: true,
      watermarkOff: true,
      fullRenderLabelPreserved: true,
      cardStateRetainedOrRestored: true,
      sameProcess: true,
      noCrash: true,
      noErrorSurface: true,
      beforeTitleHeight: baseline.titleHeight,
      afterTitleHeight: after.titleHeight,
      beforeTextNodes: after.beforeTextNodes,
      afterTextNodes: after.afterTextNodes,
      textNodesPreserved: true,
      fontScaleBefore: 1,
      fontScaleAfter: 1.5,
    }
  } catch (error) {
    failed = true
    failure = error
    if (restoreRequired) await captureFailureEvidence(io, pid)
  } finally {
    if (restoreRequired) {
      try {
        await io.shell(['am', 'force-stop', app])
        await io.shell([
          'settings',
          ...(previous === 'null'
            ? ['delete', 'system', 'font_scale']
            : ['put', 'system', 'font_scale', previous]),
        ])
      } catch (cleanup) {
        failure = failed
          ? new AggregateError([failure, cleanup], 'release_font_restore_failed')
          : cleanup
        failed = true
      }
    }
  }
  if (failed) throw failure
  return { ...result, originalFontRestored: true, passed: true }
}
