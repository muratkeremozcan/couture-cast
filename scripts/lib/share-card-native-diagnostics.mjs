import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  assertNativeFlowFailure,
  summarizeNativeFlowFailure,
} from './share-card-native-failure.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const locales = [
  'en-US',
  'en-CA',
  'fr-FR',
  'fr-CA',
  'de-DE',
  'es-419',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
]
const ids = new Set([
  'tab-home',
  'tab-community',
  'tab-settings',
  'tab-wardrobe',
  'tab-insights',
  'outfit-share-card-open',
  'share-card-title',
  'share-card-preview',
  'share-card-preview-loaded',
  'share-card-preview-loaded-.*',
  'share-card-preview-loaded-{digest}',
  'share-card-watermark',
  'share-card-save',
  'share-card-cancel',
  'share-card-feedback',
  'share-card-error',
  'share-card-retry',
  'share-card-settings',
  'share-card-refresh',
  'community-share-card-open-{fixture}',
  'community-card-author-{fixture}',
  'hero-error-state',
  'hero-loading-state',
  'outfit-recommendation-card',
  'locale-btn-undefined',
  'locale-btn-.*',
  'locale-btn-${MAESTRO_LOCALE}',
  'BackButton',
  'comments-close',
  'signin-email-input',
  'signin-code-input',
  ...locales.map((locale) => `locale-btn-${locale}`),
])
const commands = new Set([
  'tapOnElement',
  'scrollUntilVisible',
  'scrollUntilVisibleCommand',
  'assertConditionCommand',
  'extendedWaitUntilCommand',
  'runFlowCommand',
  'retryCommand',
  'waitForAnimationToEndCommand',
  'inputTextCommand',
  'defineVariablesCommand',
  'applyConfigurationCommand',
  'launchAppCommand',
  'backPressCommand',
  'unknown',
])
const statuses = new Set(['FAILED', 'RUNNING', 'COMPLETED', 'SKIPPED', 'UNAVAILABLE'])
const signatures = new Map([
  [
    'android-anr',
    /ANR in com\.couturecast\.story68|ApplicationNotResponding|isn.t responding/i,
  ],
  ['native-fatal', /FATAL EXCEPTION|Fatal signal|NSInternalInconsistencyException/],
  [
    'react-native-duplicate-linking',
    /configured linking in multiple|Looks like you have configured linking/i,
  ],
  [
    'expo-dev-launcher',
    /DevLauncherActivity|expo\.modules\.devlauncher|No development servers found/i,
  ],
  ['react-native-error', /LogBox|Unable to resolve module|ReferenceError:|TypeError:/],
  [
    'driver-connection',
    /io\.grpc\.StatusRuntimeException|driver did not start up|Unable to connect to.*driver/i,
  ],
  [
    'snapshot-failure',
    /kAXErrorInvalidUIElement|Snapshot failure while getting view hierarchy/i,
  ],
  ['permission-dialog', /com\.android\.permissioncontroller|permission_allow_button/],
])
const resourceKeys = [
  'bootCompleted',
  'uptimeSeconds',
  'memTotalKB',
  'memAvailableKB',
  'memoryPressureSome10',
  'memoryPressureFull10',
  'cpuPressureSome10',
  'ioPressureSome10',
  'hostMemTotalKB',
  'hostMemFreeKB',
  'hostUptimeSeconds',
]
const invalid = () => {
  throw new Error('invalid_native_flow_diagnostics')
}
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const finite = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const nullableInteger = (value) => value === null || integer(value)
const labelCache = new Map()
function bundledLabels(root) {
  if (labelCache.has(root)) return labelCache.get(root)
  const result = new Set([
    'Open',
    'Continue',
    'Close',
    'Wait',
    'Close app',
    'Expo Go',
    'Development servers',
    'No development servers found',
  ])
  const walk = (value) => {
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 180 &&
      !/[{}]|https?:|@|\d{6}/i.test(value)
    )
      result.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  for (const locale of locales) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(root, 'apps/mobile/assets/locales', `${locale}.json`))
    )
    for (const section of [
      catalog.shareCard,
      catalog.tabs,
      catalog.common,
      catalog.native?.notifications,
    ])
      walk(section)
  }
  labelCache.set(root, result)
  return result
}
function safeId(value) {
  if (ids.has(value)) return value
  if (/^share-card-preview-loaded-[a-f0-9]{64}$/.test(value ?? ''))
    return 'share-card-preview-loaded-{digest}'
  if (
    /^community-(share-card-open|card-author)-(?:cc68-native-)?[a-f0-9-]{36}$/i.test(
      value ?? ''
    )
  )
    return value.startsWith('community-share')
      ? 'community-share-card-open-{fixture}'
      : 'community-card-author-{fixture}'
  return 'unavailable'
}
function commandSelector(body, labels) {
  const selector =
    body.selector ??
    body.element ??
    body.condition?.visible ??
    body.condition?.notVisible ??
    body.visible ??
    {}
  const id = selector.idRegex ?? selector.id
  const text = selector.textRegex ?? selector.text
  return {
    kind: typeof id === 'string' ? 'id' : typeof text === 'string' ? 'text' : 'none',
    value: typeof id === 'string' ? safeId(id) : labels.has(text) ? text : 'unavailable',
  }
}
function commandRecord(row, labels) {
  const metadata = row?.metadata ?? {}
  const entry = Object.entries(metadata.evaluatedCommand ?? row?.command ?? {}).find(
    ([name]) => commands.has(name)
  )
  const name = entry?.[0] ?? 'unknown'
  const body = entry?.[1] ?? {}
  const selector = commandSelector(body, labels)
  return {
    name,
    status: statuses.has(metadata.status) ? metadata.status : 'UNAVAILABLE',
    selector,
    sequenceNumber: integer(metadata.sequenceNumber) ? metadata.sequenceNumber : null,
    depth: integer(metadata.depth) ? metadata.depth : null,
    durationMs: integer(metadata.duration) ? metadata.duration : null,
  }
}
const capturedFailure = (row) =>
  row?.metadata?.status === 'FAILED' &&
  Array.isArray(row.metadata.artifacts) &&
  row.metadata.artifacts.some((artifact) => artifact?.type === 'SCREEN_HIERARCHY')
// A FAILED row with its own hierarchy explains the failure. A deeper RUNNING row is
// what a killed run leaves behind and carries no artifacts, so it ranks below.
function compareFailures(a, b) {
  return (
    Number(capturedFailure(b)) - Number(capturedFailure(a)) ||
    (b.metadata.depth ?? 0) - (a.metadata.depth ?? 0) ||
    (b.metadata.sequenceNumber ?? 0) - (a.metadata.sequenceNumber ?? 0)
  )
}
function selectFailure(rows) {
  const candidates = rows.filter((row) =>
    ['FAILED', 'RUNNING'].includes(row?.metadata?.status)
  )
  return candidates.sort(compareFailures)[0]
}
function allNodes(tree) {
  return tree && typeof tree === 'object'
    ? [
        tree.attributes ?? {},
        ...(Array.isArray(tree.children) ? tree.children.flatMap(allNodes) : []),
      ]
    : []
}
function bounds(text) {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(text ?? '')
  if (!match) return null
  const [left, top, right, bottom] = match.slice(1).map(Number)
  return [left, top, right, bottom].every(Number.isSafeInteger) &&
    right > left &&
    bottom > top
    ? [left, top, right, bottom]
    : null
}
function number(text, pattern) {
  const value = pattern.exec(text ?? '')?.[1]
  return value !== undefined && finite(Number(value)) ? Number(value) : null
}
function resources(system = {}) {
  return {
    bootCompleted: /^1\s*$/.test(system.boot ?? '')
      ? true
      : /^0\s*$/.test(system.boot ?? '')
        ? false
        : null,
    uptimeSeconds: number(system.uptime, /^(\d+(?:\.\d+)?)/),
    memTotalKB: number(system.meminfo, /^MemTotal:\s*(\d+) kB$/m),
    memAvailableKB: number(system.meminfo, /^MemAvailable:\s*(\d+) kB$/m),
    memoryPressureSome10: number(system.memoryPressure, /^some avg10=(\d+(?:\.\d+)?)/m),
    memoryPressureFull10: number(system.memoryPressure, /^full avg10=(\d+(?:\.\d+)?)/m),
    cpuPressureSome10: number(system.cpuPressure, /^some avg10=(\d+(?:\.\d+)?)/m),
    ioPressureSome10: number(system.ioPressure, /^some avg10=(\d+(?:\.\d+)?)/m),
    hostMemTotalKB: Math.floor(os.totalmem() / 1024),
    hostMemFreeKB: Math.floor(os.freemem() / 1024),
    hostUptimeSeconds: Math.floor(os.uptime()),
  }
}
function projectControls(nodes, basisWidth, basisHeight) {
  const controls = []
  for (const node of nodes) {
    const id = safeId(node['resource-id'])
    const box = bounds(node.bounds)
    if (id === 'unavailable' || !box || controls.length >= 60) continue
    const [left, top, right, bottom] = box
    if (left < 0 || top < 0 || right > basisWidth || bottom > basisHeight) continue
    const normalized = [
      left / basisWidth,
      top / basisHeight,
      (right - left) / basisWidth,
      (bottom - top) / basisHeight,
    ].map((value) => Math.round(value * 1e6) / 1e6)
    controls.push({ id, bounds: normalized })
  }
  return controls
}
function projectScreen(input, nodes, labels) {
  const width =
    integer(input.screenshot?.width) && input.screenshot.width <= 4096
      ? input.screenshot.width
      : null
  const height =
    integer(input.screenshot?.height) && input.screenshot.height <= 8192
      ? input.screenshot.height
      : null
  const source =
    width &&
    height &&
    ['maestro-failed-step', 'post-failure'].includes(input.screenshot?.source)
      ? input.screenshot.source
      : 'unavailable'
  const first = bounds(nodes[0]?.bounds)
  const basisWidth = first?.[2] ?? width ?? 1,
    basisHeight = first?.[3] ?? height ?? 1
  const controls = projectControls(nodes, basisWidth, basisHeight)
  const visibleLabels = [
    ...new Set(
      nodes
        .flatMap((node) => [node.text, node.accessibilityText])
        .filter((value) => labels.has(value))
    ),
  ].slice(0, 40)
  const screenLog = nodes
    .flatMap((node) => [
      node.text,
      node.accessibilityText,
      node['resource-id'],
      node.class,
    ])
    .filter((value) => typeof value === 'string')
    .join('\n')
  return {
    source,
    width: source === 'unavailable' ? null : width,
    height: source === 'unavailable' ? null : height,
    redaction: 'all-original-pixels-masked',
    controls,
    labels: visibleLabels,
    nodeCount: nodes.length,
    signatures: matchedSignatures(screenLog),
  }
}
function matchedSignatures(log) {
  return [...signatures].filter(([, pattern]) => pattern.test(log)).map(([name]) => name)
}
const presentationEvents = new Set([
  'open',
  'drop:root',
  'drop:signed-out',
  'render',
  'close',
  'retire',
])
const ratio = (value, basis) => Math.round((value / basis) * 1e6) / 1e6
/** Maestro's own scroll, tap and settle lines, as numbers normalized to the device. */
function projectInteractions(log, screen) {
  if (typeof log !== 'string') return []
  const device = log.match(/DeviceWidth: (\d+), DeviceWidth: (\d+)/)
  const width = device ? Number(device[1]) : screen.width
  const height = device ? Number(device[2]) : screen.height
  if (!width || !height) return []
  const rows = []
  for (const line of log.split('\n')) {
    const scroll = line.match(/Scrolling try count: (\d+),/)
    const element = line.match(
      /Element bounds: Bounds\(x=(-?\d+), y=(-?\d+), width=(\d+), height=(\d+)\)/
    )
    const tap = line.match(/Tapping at \((\d+), (\d+)\)/)
    if (scroll) rows.push({ kind: 'scroll', attempt: Number(scroll[1]), element: null })
    else if (element && rows.at(-1)?.kind === 'scroll' && rows.at(-1).element === null)
      rows.at(-1).element = [
        ratio(Number(element[1]), width),
        ratio(Number(element[2]), height),
        ratio(Number(element[3]), width),
        ratio(Number(element[4]), height),
      ]
    else if (tap)
      rows.push({
        kind: 'tap',
        point: [ratio(Number(tap[1]), width), ratio(Number(tap[2]), height)],
      })
    else if (/Something has changed in the UI/.test(line))
      rows.push({ kind: 'settle', changed: true })
    else if (/Nothing changed in the UI/.test(line))
      rows.push({ kind: 'settle', changed: false })
  }
  return rows.slice(-24)
}
function projectPresentationTrace(logcat) {
  if (typeof logcat !== 'string') return []
  return [...logcat.matchAll(/\[cc68-presentation\] ([a-z:-]+)/g)]
    .map((match) => match[1])
    .filter((event) => presentationEvents.has(event))
    .slice(-24)
}
const unit = (value) => typeof value === 'number' && value >= -1 && value <= 2
const interactionChecks = {
  scroll: (row) =>
    exact(row, ['kind', 'attempt', 'element']) &&
    integer(row.attempt) &&
    (row.element === null ||
      (Array.isArray(row.element) &&
        row.element.length === 4 &&
        row.element.every(unit))),
  tap: (row) =>
    exact(row, ['kind', 'point']) &&
    Array.isArray(row.point) &&
    row.point.length === 2 &&
    row.point.every((value) => unit(value) && value >= 0 && value <= 1),
  settle: (row) => exact(row, ['kind', 'changed']) && typeof row.changed === 'boolean',
}
function checkInteractionFacts(value) {
  if (
    !Array.isArray(value.interactions) ||
    value.interactions.length > 24 ||
    !value.interactions.every((row) =>
      Object.hasOwn(interactionChecks, row?.kind)
        ? interactionChecks[row.kind](row)
        : false
    ) ||
    !Array.isArray(value.presentationTrace) ||
    value.presentationTrace.length > 24 ||
    value.presentationTrace.some((event) => !presentationEvents.has(event))
  )
    invalid()
}
export function projectNativeFlowDiagnostics(input) {
  const labels = bundledLabels(input.root ?? repository)
  const rows = Array.isArray(input.commands) ? input.commands : []
  const failed = selectFailure(rows)
  const nodes = allNodes(input.hierarchy)
  const screen = projectScreen(input, nodes, labels)
  const screenLog = nodes
    .flatMap((node) => [
      node.text,
      node.accessibilityText,
      node['resource-id'],
      node.class,
    ])
    .filter((value) => typeof value === 'string')
    .join('\n')
  const log = [input.log, input.logcat, screenLog]
    .filter((value) => typeof value === 'string')
    .join('\n')
  const result = {
    version: 1,
    ...summarizeNativeFlowFailure({
      flow: input.flow,
      platform: input.platform,
      durationMs: input.durationMs,
      log: input.log ?? '',
    }),
    exitCode: nullableInteger(input.exitCode) ? input.exitCode : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(input.signal)
      ? input.signal
      : null,
    failedCommand: failed ? commandRecord(failed, labels) : null,
    recentCommands: rows.slice(-12).map((row) => commandRecord(row, labels)),
    interactions: projectInteractions(input.log, screen),
    presentationTrace: projectPresentationTrace(input.logcat),
    signatures: [...signatures]
      .filter(([, pattern]) => pattern.test(log))
      .map(([name]) => name),
    screen,
    resources: resources(input.system),
    captures: {
      commands: rows.length > 0,
      hierarchy: !!input.hierarchy,
      screenshot: screen.source !== 'unavailable',
      logcat: typeof input.logcat === 'string',
      system: Object.values(input.system ?? {}).some(
        (value) => typeof value === 'string'
      ),
    },
    capturedAfterFailureMs: integer(input.capturedAfterFailureMs)
      ? input.capturedAfterFailureMs
      : 0,
  }
  assertNativeFlowDiagnostics(result, { root: input.root ?? repository })
  return result
}
function checkCommand(command, labels) {
  if (
    !exact(command, [
      'name',
      'status',
      'selector',
      'sequenceNumber',
      'depth',
      'durationMs',
    ]) ||
    !commands.has(command.name) ||
    !statuses.has(command.status) ||
    ![command.sequenceNumber, command.depth, command.durationMs].every(nullableInteger) ||
    !exact(command.selector, ['kind', 'value'])
  )
    invalid()
  const { kind, value: selector } = command.selector
  if (
    !['id', 'text', 'none'].includes(kind) ||
    !(
      selector === 'unavailable' ||
      (kind === 'id' && ids.has(selector)) ||
      (kind === 'text' && labels.has(selector))
    )
  )
    invalid()
}
function checkControl(control) {
  if (
    !exact(control, ['id', 'bounds']) ||
    !ids.has(control.id) ||
    !Array.isArray(control.bounds) ||
    control.bounds.length !== 4 ||
    !control.bounds.every((value) => finite(value) && value <= 1) ||
    control.bounds[2] <= 0 ||
    control.bounds[3] <= 0 ||
    control.bounds[0] + control.bounds[2] > 1.000001 ||
    control.bounds[1] + control.bounds[3] > 1.000001
  )
    invalid()
}
function checkScreenDimensions(screen) {
  if (
    screen.source === 'unavailable'
      ? screen.width !== null || screen.height !== null
      : !integer(screen.width) ||
        screen.width < 1 ||
        screen.width > 4096 ||
        !integer(screen.height) ||
        screen.height < 1 ||
        screen.height > 8192
  )
    invalid()
}
function checkScreen(screen, labels) {
  if (
    !exact(screen, [
      'source',
      'width',
      'height',
      'redaction',
      'controls',
      'labels',
      'nodeCount',
      'signatures',
    ]) ||
    !['maestro-failed-step', 'post-failure', 'unavailable'].includes(screen.source) ||
    screen.redaction !== 'all-original-pixels-masked' ||
    !integer(screen.nodeCount)
  )
    invalid()
  checkScreenDimensions(screen)
  if (
    !Array.isArray(screen.signatures) ||
    screen.signatures.some((name) => !signatures.has(name))
  )
    invalid()
  if (
    !Array.isArray(screen.labels) ||
    screen.labels.length > 40 ||
    screen.labels.some((label) => !labels.has(label)) ||
    !Array.isArray(screen.controls) ||
    screen.controls.length > 60
  )
    invalid()
  screen.controls.forEach(checkControl)
}
function checkResources(resources) {
  if (!exact(resources, resourceKeys)) invalid()
  for (const key of resourceKeys)
    if (
      resources[key] !== null &&
      (key === 'bootCompleted'
        ? typeof resources[key] !== 'boolean'
        : !finite(resources[key]) || (/Pressure/.test(key) && resources[key] > 100))
    )
      invalid()
}
function checkCaptures(captures, screen, recentCommands) {
  if (
    !exact(captures, ['commands', 'hierarchy', 'screenshot', 'logcat', 'system']) ||
    Object.values(captures).some((flag) => typeof flag !== 'boolean')
  )
    invalid()
  if (
    captures.screenshot !== (screen.source !== 'unavailable') ||
    captures.commands !== recentCommands.length > 0 ||
    (!captures.hierarchy &&
      (screen.controls.length || screen.labels.length || screen.nodeCount))
  )
    invalid()
}
export function assertNativeFlowDiagnostics(value, { root = repository } = {}) {
  if (
    !exact(value, [
      'version',
      'flow',
      'platform',
      'classification',
      'durationMs',
      'exitCode',
      'signal',
      'failedCommand',
      'recentCommands',
      'interactions',
      'presentationTrace',
      'signatures',
      'screen',
      'resources',
      'captures',
      'capturedAfterFailureMs',
    ]) ||
    value.version !== 1
  )
    invalid()
  try {
    assertNativeFlowFailure({
      flow: value.flow,
      platform: value.platform,
      classification: value.classification,
      durationMs: value.durationMs,
    })
  } catch {
    invalid()
  }
  if (
    !nullableInteger(value.exitCode) ||
    ![null, 'SIGTERM', 'SIGKILL', 'SIGABRT'].includes(value.signal) ||
    !integer(value.capturedAfterFailureMs)
  )
    invalid()
  const labels = bundledLabels(root)
  if (value.failedCommand !== null) checkCommand(value.failedCommand, labels)
  if (!Array.isArray(value.recentCommands) || value.recentCommands.length > 12) invalid()
  value.recentCommands.forEach((command) => checkCommand(command, labels))
  if (
    !Array.isArray(value.signatures) ||
    value.signatures.some((name) => !signatures.has(name))
  )
    invalid()
  checkInteractionFacts(value)
  checkScreen(value.screen, labels)
  checkResources(value.resources)
  checkCaptures(value.captures, value.screen, value.recentCommands)
}

/** No source screenshot pixels enter this derivative. Only validated geometry and bundled labels. */
export async function writeRedactedNativeFailureImage(value, file, options) {
  assertNativeFlowDiagnostics(value, options)
  if (value.screen.source === 'unavailable') return false
  const { width, height } = value.screen
  const escape = (text) =>
    text.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[
          character
        ]
    )
  const rectangles = value.screen.controls
    .map((control) => {
      const [x, y, w, h] = control.bounds
      return `<rect x="${x * width}" y="${y * height}" width="${w * width}" height="${h * height}" fill="none" stroke="#54b5ff" stroke-width="2"/><text x="${x * width + 4}" y="${y * height + 16}" fill="#54b5ff" font-size="14">${escape(control.id)}</text>`
    })
    .join('')
  const lines = [
    'FULLY REDACTED FAILED-STEP SCREENSHOT',
    `${value.flow}: ${value.failedCommand?.name ?? 'unavailable'} ${value.failedCommand?.selector.value ?? 'unavailable'}`,
    'All original pixels masked. Outlines and fixed bundled labels only.',
    `Screen signatures: ${value.screen.signatures.join(', ') || 'none observed'}`,
    ...value.screen.labels,
  ]
    .map(
      (text, index) =>
        `<text x="16" y="${24 + index * 23}" fill="#ffffff" font-size="16">${escape(text)}</text>`
    )
    .join('')
  const sharp = (await import('sharp')).default
  await sharp(
    Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#15191f"/>${rectangles}<rect width="100%" height="${Math.min(height, 100 + value.screen.labels.length * 23)}" fill="#20252d"/>${lines}</svg>`
    )
  )
    .png()
    .toFile(file)
  return true
}
function artifactFile(base, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) return null
  const file = path.resolve(base, relative)
  if (!file.startsWith(path.resolve(base) + path.sep)) return null
  try {
    return fs.lstatSync(file).isFile() &&
      fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep)
      ? file
      : null
  } catch {
    return null
  }
}
function filesUnder(output) {
  const found = [],
    queue = [output]
  while (queue.length && found.length < 1024) {
    const directory = queue.shift()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) queue.push(file)
      else if (entry.isFile()) found.push(file)
    }
  }
  return found
}
const textFile = (file) => {
  try {
    const size = fs.statSync(file).size
    return size <= 2 * 1024 * 1024 ? fs.readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}
function readArtifacts(output) {
  const files = filesUnder(output)
  let rows = [],
    failed,
    base = output,
    hierarchy,
    screenshot,
    log = ''
  for (const file of files.filter((file) => path.basename(file) === 'commands.json')) {
    try {
      const candidate = JSON.parse(textFile(file))
      if (!Array.isArray(candidate)) continue
      const failure = selectFailure(candidate)
      if (failure && (!failed || compareFailures(failure, failed) <= 0)) {
        rows = candidate
        failed = failure
        base = path.dirname(file)
      }
    } catch {
      /* Raw malformed artifacts stay private. */
    }
  }
  for (const file of files.filter((file) => path.basename(file) === 'maestro.log'))
    log += '\n' + textFile(file)
  for (const artifact of failed?.metadata?.artifacts ?? []) {
    const file = artifactFile(base, artifact.path)
    if (!file) continue
    if (artifact.type === 'SCREEN_HIERARCHY') {
      try {
        hierarchy = JSON.parse(textFile(file))
      } catch {
        /* Keep unknown raw content private. */
      }
    }
    if (artifact.type === 'SCREENSHOT')
      screenshot = { file, source: 'maestro-failed-step' }
  }
  return { rows, hierarchy, screenshot, log }
}
function captureCall(input, execute, started, privateDir) {
  return (name, args, binary = input.adb) => {
    if (Date.now() - started > 9000) return null
    try {
      const result = execute(binary, args, {
        encoding: 'utf8',
        timeout: Math.min(1500, 10000 - (Date.now() - started)),
        maxBuffer: 2 * 1024 * 1024,
        killSignal: 'SIGKILL',
      })
      const text = result.stdout?.toString() ?? ''
      if (!input.sensitive)
        fs.writeFileSync(path.join(privateDir, `${name}.log`), text, { mode: 0o600 })
      return result.status === 0 ? text : null
    } catch {
      return null
    }
  }
}
function fallbackScreenshot(input, execute, privateDir, screenshot) {
  // Prefer the exact command artifact. The fallback is explicitly labelled after-failure.
  if (!screenshot && !input.sensitive) {
    const file = path.join(privateDir, 'after-failure.png')
    try {
      const binary = input.platform === 'android' ? input.adb : 'xcrun'
      const args =
        input.platform === 'android'
          ? ['-s', input.device, 'exec-out', 'screencap', '-p']
          : ['simctl', 'io', input.device, 'screenshot', file]
      const result = execute(binary, args, {
        encoding: undefined,
        timeout: 1500,
        maxBuffer: 12 * 1024 * 1024,
        killSignal: 'SIGKILL',
      })
      if (result.status === 0) {
        if (input.platform === 'android' && Buffer.isBuffer(result.stdout))
          fs.writeFileSync(file, result.stdout, { mode: 0o600 })
        if (fs.existsSync(file)) screenshot = { file, source: 'post-failure' }
      }
    } catch {
      /* The original failure remains authoritative. */
    }
  }
  return screenshot
}
function captureSystem(input, call) {
  let system, logcat
  if (
    input.platform === 'android' &&
    /^emulator-\d{4}$/.test(input.device ?? '') &&
    typeof input.adb === 'string'
  ) {
    const shell = (args) => ['-s', input.device, 'shell', ...args]
    system = {
      boot: call('boot', shell(['getprop', 'sys.boot_completed'])),
      uptime: call('uptime', shell(['cat', '/proc/uptime'])),
      meminfo: call('meminfo', shell(['cat', '/proc/meminfo'])),
      memoryPressure: call('memory-pressure', shell(['cat', '/proc/pressure/memory'])),
      cpuPressure: call('cpu-pressure', shell(['cat', '/proc/pressure/cpu'])),
      ioPressure: call('io-pressure', shell(['cat', '/proc/pressure/io'])),
    }
    logcat =
      call('logcat', ['-s', input.device, 'logcat', '-d', '-t', '600']) ?? undefined
  }
  if (input.platform === 'ios' && /^[A-Fa-f0-9-]{36}$/.test(input.device ?? '')) {
    logcat =
      call(
        'simulator-system-log',
        [
          'simctl',
          'spawn',
          input.device,
          'log',
          'show',
          '--last',
          '1m',
          '--style',
          'compact',
          '--predicate',
          'process == "CoutureCastStory68"',
        ],
        'xcrun'
      ) ?? undefined
  }
  return { system, logcat }
}
export async function collectNativeFlowDiagnostics(input, { execute = spawnSync } = {}) {
  if (
    !['android', 'ios'].includes(input.platform) ||
    !path.resolve(input.output).startsWith(path.resolve(input.directory) + path.sep)
  )
    invalid()
  summarizeNativeFlowFailure({
    flow: input.flow,
    platform: input.platform,
    durationMs: input.durationMs,
    log: '',
  })
  const root = input.root ?? repository,
    started = Date.now(),
    privateDir = path.join(input.output, 'failure-private')
  fs.mkdirSync(privateDir, { mode: 0o700 })
  const artifacts = readArtifacts(input.output)
  const { rows, hierarchy, log } = artifacts
  let { screenshot } = artifacts
  const call = captureCall(input, execute, started, privateDir)
  screenshot = fallbackScreenshot(input, execute, privateDir, screenshot)
  const { system, logcat } = captureSystem(input, call)
  if (screenshot && !input.sensitive) {
    try {
      const metadata = await (await import('sharp')).default(screenshot.file).metadata()
      screenshot = { ...screenshot, width: metadata.width, height: metadata.height }
    } catch {
      screenshot = undefined
    }
  } else screenshot = undefined
  const value = projectNativeFlowDiagnostics({
    ...input,
    root,
    commands: rows,
    hierarchy: input.sensitive ? undefined : hierarchy,
    screenshot,
    log: `${log}\n${input.log ?? ''}`,
    system,
    logcat,
    capturedAfterFailureMs: Math.max(0, Date.now() - started),
  })
  fs.writeFileSync(
    path.join(input.directory, `native-flow-diagnostics-${input.platform}.json`),
    JSON.stringify(value, null, 2) + '\n',
    { mode: 0o600 }
  )
  await writeRedactedNativeFailureImage(
    value,
    path.join(input.directory, `native-flow-diagnostics-${input.platform}-redacted.png`),
    { root }
  )
  return value
}
/** Failure-only bounded child keeps normal flow and product deadlines unchanged. */
export function recordNativeFlowDiagnostics(input) {
  try {
    return (
      spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--capture'], {
        input: JSON.stringify(input),
        encoding: 'utf8',
        timeout: 15000,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
      }).status === 0
    )
  } catch {
    return false
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === '--capture'
) {
  try {
    await collectNativeFlowDiagnostics(JSON.parse(fs.readFileSync(0, 'utf8')))
  } catch {
    process.exitCode = 1
  }
}
