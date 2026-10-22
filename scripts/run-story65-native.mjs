#!/usr/bin/env node
// Story 6.5 owner: N1/N2 native acceptance runner for the isolated com.couturecast.story65 build.

/**
 * Drives real native identity and OS notification taps against an owned harness.
 *
 * The harness directory (for example repairs/c-doc) supplies the isolated API, UUID
 * database, local Auth proxy and public build environment. Commands:
 *
 *   prepare                       provision accounts and community targets
 *   signin  --account <label>     real sign-in UI with real verifyNativeOtp
 *   tap     --case <case>         present an OS notification and tap it in the OS UI
 *   permission --case <case>      denied | granted | revoked through the OS
 *
 * Boundaries:
 * - The local Auth Admin credential stays in this Node process. It never reaches Metro, the
 *   app, Maestro or an artifact.
 * - Each OTP reaches Maestro only as MAESTRO_OTP in the child environment. That Maestro run's
 *   debug output goes to a private 0700 directory, is redacted into the evidence log and is
 *   then deleted.
 * - Android presents notifications through the debug-only fixture deep link, and iOS through
 *   `simctl push`. Both only schedule. The proof is the Maestro tap on the presented OS
 *   notification, followed by the destination assertion.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
import { MAESTRO_PINNED_VERSION } from './maestro-version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flows = path.join(root, 'maestro', 'story65')
const appId = 'com.couturecast.story65'
const api = 'http://127.0.0.1:4077'
const metroUrl = 'http://127.0.0.1:8088'
const devClientUrl = `exp+couture-cast://expo-development-client/?url=${encodeURIComponent(metroUrl)}`
const adbPath = '/Users/murat/Library/Android/sdk/platform-tools/adb'
const maestroPath = '/opt/homebrew/bin/maestro'
const notificationBody = 'Your post has new engagement.'

const args = parseArgs(process.argv.slice(2))
const harness = path.resolve(requireArg('harness'))
const platform = requireArg('platform')
if (!['android', 'ios'].includes(platform))
  throw new Error('--platform must be android or ios')
const device =
  platform === 'android'
    ? (args.device ?? 'emulator-5580')
    : readJson(path.join(harness, 'ios-simulator.json')).udid
const evidence = path.join(harness, 'native', platform)
fs.mkdirSync(evidence, { recursive: true })
const statePath = path.join(evidence, 'state.json')

const owned = readJson(path.join(harness, 'owned-env.json'))
const publicEnv = readJson(path.join(harness, 'public-build-env.json'))
const authHarness = readJson(path.join(harness, 'auth-harness.json'))
if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(owned.DATABASE_URL).pathname))
  throw new Error('An isolated UUID database is required.')

const strings = Object.fromEntries(
  ['en-US', 'es-419', 'fr-FR'].map((locale) => {
    const json = readJson(path.join(root, 'apps/mobile/assets/locales', `${locale}.json`))
    return [locale, json]
  })
)

function parseArgs(argv) {
  const parsed = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value.startsWith('--')) parsed[value.slice(2)] = argv[++index]
    else parsed._.push(value)
  }
  return parsed
}

function requireArg(name) {
  if (!args[name]) throw new Error(`--${name} is required`)
  return args[name]
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function log(event, detail = {}) {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), platform, event, ...detail })
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(description, probe, { timeout = 30_000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await sleep(interval)
  }
}

// ---------------------------------------------------------------------------------------
// Accounts and local Auth

function adminClient() {
  // Load the local Admin credential into this process only; children get explicit envs.
  const local = {}
  loadEnv({ path: path.join(root, '.env.local'), processEnv: local, quiet: true })
  const origin = new URL(local.SUPABASE_URL ?? '')
  if (!['localhost', '127.0.0.1'].includes(origin.hostname))
    throw new Error('Native fixtures require local Supabase Auth.')
  if (!local.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Local Auth Admin is unavailable.')
  return createClient(origin.href, local.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function apiJson(method, pathname, { body, bearer, headers = {} } = {}) {
  const response = await fetch(`${api}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function recordIdentity(account) {
  const file = path.join(harness, 'created-identities.json')
  const rows = fs.existsSync(file) ? readJson(file) : []
  fs.writeFileSync(file, `${JSON.stringify([...rows, account], null, 2)}\n`, {
    mode: 0o600,
  })
}

async function provisionAccount(admin, { mapping, label }) {
  const email = `story65-real-${randomUUID()}@example.test`
  const signup = await apiJson('POST', '/api/v1/auth/signup', {
    body: { email, birthdate: '1990-06-15' },
  })
  if (signup.status !== 201) throw new Error(`Owned app signup failed: ${signup.status}`)
  const appUserId = signup.body.userId
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(mapping === 'metadata'
      ? { app_metadata: { app_user_id: appUserId, app_role: 'guardian' } }
      : {}),
  })
  if (error || !data.user) throw new Error('Owned local Auth account creation failed.')
  if (data.user.id === appUserId)
    throw new Error('The auth/app identity mismatch is required.')
  const account = {
    appUserId,
    authUserId: data.user.id,
    email,
    mapping,
    issueMode: 'generated',
    label,
  }
  recordIdentity(account)
  return account
}

function otpFile(email) {
  const name = `${createHash('sha256').update(email).digest('hex')}.json`
  return path.join(authHarness.otpDir, name)
}

/** Reads a code the owned proxy issued after `since`; the value never leaves memory. */
async function freshCode(email, since) {
  return waitFor(
    'an owned OTP',
    () => {
      try {
        const value = readJson(otpFile(email))
        return value.issuedAt >= since && /^\d{6,10}$/.test(value.code)
          ? value.code
          : null
      } catch {
        return null
      }
    },
    { timeout: 30_000 }
  )
}

async function nodeBearer(account) {
  const auth = createClient(
    authHarness.proxyUrl,
    publicEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  ).auth
  const since = Date.now()
  const issued = await auth.signInWithOtp({
    email: account.email,
    options: { shouldCreateUser: false },
  })
  if (issued.error) throw new Error('Owned OTP issuance failed.')
  const { data, error } = await auth.verifyOtp({
    email: account.email,
    token: await freshCode(account.email, since),
    type: 'email',
  })
  if (error || !data.session) throw new Error('Owned OTP verification failed.')
  return data.session.access_token
}

// ---------------------------------------------------------------------------------------
// Community targets

async function withDb(work) {
  const client = new pg.Client({
    connectionString: owned.DATABASE_URL.replace(/\?.*$/, ''),
  })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function createComment(bearer, postId, body, parentId = null) {
  const response = await apiJson('POST', `/api/v1/community/posts/${postId}/comments`, {
    bearer,
    headers: { 'x-couture-platform': 'mobile' },
    body: { mutationId: randomUUID(), body, locale: 'en-US', parentId },
  })
  if (response.status !== 200)
    throw new Error(`Comment creation failed: ${response.status}`)
  return response.body.data.id
}

async function waitPublished(ids) {
  await withDb((client) =>
    waitFor(
      `${ids.length} published comments`,
      async () => {
        const { rows } = await client.query(
          'select count(*)::int as n from "CommunityComment" where id = any($1) and status = $2',
          [ids, 'published']
        )
        return rows[0].n === ids.length
      },
      { timeout: 120_000, interval: 1_000 }
    )
  )
}

async function prepare() {
  const admin = adminClient()
  const recipient = await provisionAccount(admin, {
    mapping: 'metadata',
    label: `${platform}-recipient-metadata`,
  })
  const second = await provisionAccount(admin, {
    mapping: 'email',
    label: `${platform}-second-email`,
  })
  const author = await provisionAccount(admin, {
    mapping: 'metadata',
    label: `${platform}-comment-author`,
  })
  const bearer = await nodeBearer(author)
  const stamp = Date.now()
  const root = await createComment(
    bearer,
    'lookbook-1',
    `Story65 ${platform} root ${stamp}`
  )
  await waitPublished([root])
  // 21 replies: the last one sits on the second reply page (page size 20).
  const replies = []
  for (let index = 1; index <= 21; index++)
    replies.push(
      await createComment(bearer, 'lookbook-1', `Story65 reply ${index} ${stamp}`, root)
    )
  await waitPublished(replies)
  const lateRoot = await createComment(
    bearer,
    'lookbook-2',
    `Story65 ${platform} card ${stamp}`
  )
  await waitPublished([lateRoot])
  const state = {
    preparedAt: new Date().toISOString(),
    accounts: { recipient, second, author },
    targets: {
      offPageReply: { cardId: 'lookbook-1', commentId: replies[20], parentId: root },
      rootComment: { cardId: 'lookbook-2', commentId: lateRoot },
      card: { cardId: 'lookbook-3' },
      unavailable: { cardId: `missing-${randomUUID()}` },
    },
  }
  writeJson(statePath, state)
  log('prepared', {
    accounts: Object.fromEntries(
      Object.entries(state.accounts).map(([key, value]) => [key, value.authUserId])
    ),
    targets: state.targets,
  })
  await locate()
}

// ---------------------------------------------------------------------------------------
// Devices

function run(command, commandArgs, { allowFail = false, env } = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', env })
  if (!allowFail && result.status !== 0)
    throw new Error(
      `${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`
    )
  return result
}

const adb = (...rest) => run(adbPath, ['-s', device, ...rest])
const simctl = (...rest) => run('xcrun', ['simctl', ...rest])

/** The emulator reaches the owned API, Metro and Auth proxy over loopback reverses. */
function ensureAndroidReverses() {
  // An adb transport reset (the emulator briefly goes offline under host load) drops
  // reverses, so wait for the device and re-assert the owned ones before each use.
  run(adbPath, ['-s', device, 'wait-for-device'])
  for (const port of [4077, 8088, 53051]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
}

function openApp() {
  if (platform === 'android') {
    ensureAndroidReverses()
    // Launch like the home-screen icon (ACTION_MAIN). The dev client then loads its most
    // recent bundle, our Metro. Launching with the dev-client VIEW URL instead makes that
    // URL the activity's intent, and expo-notifications' forwarder re-delivers it on a
    // notification tap, so the dev launcher reloads the bundle mid-routing.
    adb(
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      `${appId}/.MainActivity`
    )
  } else openIosApp()
}

/**
 * simctl openurl intermittently fails (LSApplicationWorkspace error 115) right after the
 * app was terminated; launching the app first and retrying the URL makes it deterministic.
 */
function openIosApp() {
  run('xcrun', ['simctl', 'launch', device, appId], { allowFail: true })
  for (let attempt = 1; ; attempt++) {
    const result = run('xcrun', ['simctl', 'openurl', device, devClientUrl], {
      allowFail: true,
    })
    if (result.status === 0) return
    if (attempt === 3) throw new Error(`simctl openurl failed: ${result.stderr}`)
    spawnSync('sleep', ['2'])
  }
}

function stopApp() {
  // Setup only. Force-stop also cancels presented notifications, so cold cases never use it.
  if (platform === 'android') adb('shell', 'am', 'force-stop', appId)
  // simctl terminate exits non-zero (ESRCH) when the app is not running.
  else run('xcrun', ['simctl', 'terminate', device, appId], { allowFail: true })
}

function appRunning() {
  if (platform === 'android')
    return (
      run(adbPath, ['-s', device, 'shell', 'pidof', appId], { allowFail: true })
        .status === 0
    )
  const out = run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], {
    allowFail: true,
  })
  return out.stdout.includes(`UIKitApplication:${appId}`)
}

function goHome() {
  if (platform === 'android') adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
  else run('xcrun', ['simctl', 'ui', device, 'home'], { allowFail: true })
}

/** Ends only the owned app process while keeping its presented notification. */
async function terminateKeepingNotification() {
  goHome()
  await sleep(1_500)
  if (platform === 'android') adb('shell', 'am', 'kill', appId)
  else simctl('terminate', device, appId)
  await waitFor('the app process to end', () => !appRunning(), { timeout: 15_000 })
}

function androidNotificationCount() {
  // dumpsys can fail transiently while the emulator is loaded; callers poll, so count 0.
  const out = run(
    adbPath,
    ['-s', device, 'shell', 'dumpsys', 'notification', '--noredact'],
    {
      allowFail: true,
    }
  ).stdout
  return out
    .split('\n')
    .filter(
      (line) => line.includes(`pkg=${appId}`) && line.includes('NotificationRecord')
    ).length
}

function notificationData(target, { expired = false } = {}) {
  return {
    version: 1,
    notificationId: randomUUID(),
    source: 'notification',
    type: 'community',
    ...target,
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(),
  }
}

/** Schedules the OS notification. This is input only; it is never the tap proof. */
async function present(data) {
  if (platform === 'android') {
    const before = androidNotificationCount()
    const url = `couturecast-story65://__story65__/notification?data=${encodeURIComponent(JSON.stringify(data))}`
    adb(
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `'${url}'`,
      appId
    )
    await waitFor(
      'the OS to present the notification',
      () => androidNotificationCount() > before,
      {
        timeout: 20_000,
      }
    )
    return
  }
  // expo-notifications serializes remote notification data from userInfo.body.
  const payload = path.join(evidence, `push-${data.notificationId}.apns`)
  writeJson(payload, {
    'Simulator Target Bundle': appId,
    aps: { alert: { title: 'CoutureCast', body: notificationBody }, sound: 'default' },
    body: data,
  })
  return startIosPushTrigger(payload)
}

/**
 * A one-shot local trigger that delivers the prepared simctl push when the Maestro flow asks
 * for it (maestro/story65/push-trigger.js), so the banner appears while the flow watches. It
 * runs as a child process because Maestro runs synchronously in this process.
 */
async function startIosPushTrigger(payload) {
  // Answers every request (the warm iOS case may re-fire a missed banner); exits when the
  // runner ends it after the flow, or on its own after ten minutes.
  const source = `
    const http = require('node:http'), { spawnSync } = require('node:child_process')
    const [device, appId, payload] = process.argv.slice(1)
    let pushed = 0
    const server = http.createServer((req, res) => {
      const result = spawnSync('xcrun', ['simctl', 'push', device, appId, payload])
      // simctl returns on delivery; give SpringBoard time to animate the banner in.
      spawnSync('sleep', ['1.5'])
      if (result.status === 0) pushed++
      res.writeHead(result.status === 0 ? 200 : 500).end()
    })
    server.listen(0, '127.0.0.1', () => console.log(server.address().port))
    process.on('SIGTERM', () => process.exit(pushed > 0 ? 0 : 1))
    setTimeout(() => process.exit(pushed > 0 ? 0 : 2), 600000).unref()`
  const child = spawn(process.execPath, ['-e', source, device, appId, payload], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())))
    child.once('exit', (code) => reject(new Error(`push trigger exited ${code}`)))
  })
  const delivered = new Promise((resolve, reject) => {
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`simctl push trigger exited ${code}`))
    )
  })
  // The runner calls finish() after the flow; the trigger reports whether any push landed.
  const finish = () => {
    child.kill('SIGTERM')
    return delivered
  }
  return { url: `http://127.0.0.1:${port}/push`, finish }
}

// ---------------------------------------------------------------------------------------
// Maestro

function checkMaestro() {
  const version = run(maestroPath, ['--version']).stdout.trim().split('\n').pop()
  if (version !== MAESTRO_PINNED_VERSION)
    throw new Error(
      `Maestro ${version} does not match the pinned ${MAESTRO_PINNED_VERSION}`
    )
}

function localeEnv(locale) {
  const json = strings[locale]
  const n = json.community.notifications
  return {
    MAESTRO_TITLE: n.title,
    MAESTRO_SIGNIN: n.signin,
    MAESTRO_SEND: n.sendCode,
    MAESTRO_VERIFY: n.verify,
    MAESTRO_CODE_SENT: n.codeSent,
    MAESTRO_EMAIL_LABEL: n.email,
    MAESTRO_CODE_LABEL: n.code,
    MAESTRO_ENABLED: n.enabled,
    MAESTRO_SAVE: n.save,
    MAESTRO_PERMISSION: n.permission,
    MAESTRO_DEVICE_SETTINGS: n.deviceSettings,
    MAESTRO_SIGNOUT: n.signout,
    MAESTRO_COMMUNITY_TITLE: json.community.title,
    MAESTRO_COMMENTS_TITLE: json.community.comments.title,
    MAESTRO_INVALID: json.community.deepLink.invalid,
    MAESTRO_LOCALE: locale,
    MAESTRO_BACK: json.common.back,
  }
}

/**
 * Runs one Maestro flow. Secret values are redacted from the captured output, and private
 * runs keep Maestro's own debug output out of the evidence tree.
 */
function maestro(flow, label, env, { secrets = [], privateOutput = false } = {}) {
  const output = privateOutput
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'story65-maestro-'))
    : path.join(evidence, 'maestro', label)
  if (privateOutput) fs.chmodSync(output, 0o700)
  else fs.mkdirSync(output, { recursive: true })
  const childEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    JAVA_HOME:
      process.env.JAVA_HOME ??
      '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    MAESTRO_APP_ID: appId,
    MAESTRO_CLI_NO_ANALYTICS: '1',
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    ...env,
  }
  // Maestro's Android driver shutdown can drop adb reverses, so re-assert them around runs.
  if (platform === 'android') ensureAndroidReverses()
  const result = spawnSync(
    maestroPath,
    [
      '--device',
      device,
      'test',
      '--test-output-dir',
      output,
      '--flatten-debug-output',
      '--debug-output',
      output,
      path.join(flows, flow),
    ],
    { encoding: 'utf8', env: childEnv, maxBuffer: 50 * 1024 * 1024 }
  )
  let text = `${result.stdout}\n${result.stderr}`
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
  fs.writeFileSync(path.join(evidence, `maestro-${label}.log`), text)
  if (privateOutput) fs.rmSync(output, { recursive: true, force: true })
  if (platform === 'android') ensureAndroidReverses()
  log('maestro', { flow, label, status: result.status })
  if (result.status !== 0) throw new Error(`Maestro flow ${flow} failed (${label})`)
}

function captureHierarchy(label) {
  const out = run(maestroPath, ['--device', device, 'hierarchy'], { allowFail: true })
  fs.writeFileSync(path.join(evidence, `hierarchy-${label}.json`), out.stdout)
}

// ---------------------------------------------------------------------------------------
// Commands

function state() {
  if (!fs.existsSync(statePath)) throw new Error('Run prepare first.')
  return readJson(statePath)
}

async function freshApp() {
  stopApp()
  openApp()
  maestro('open-app.yaml', `open-${Date.now()}`, localeEnv('en-US'))
}

async function signin() {
  await signInAccount(requireArg('account'), args.locale ?? 'en-US', { fresh: true })
}

/** Real sign-in UI and real verifyNativeOtp; the OTP reaches Maestro only through env. */
async function signInAccount(label, locale, { fresh }) {
  const account = state().accounts[label]
  if (!account) throw new Error(`Unknown account ${label}`)
  if (fresh) await freshApp()
  else maestro('open-app.yaml', `open-${label}-${Date.now()}`, localeEnv(locale))
  const since = Date.now()
  maestro('signin-request.yaml', `signin-request-${label}`, {
    ...localeEnv(locale),
    MAESTRO_EMAIL: account.email,
  })
  const code = await freshCode(account.email, since)
  maestro(
    'signin-verify.yaml',
    `signin-verify-${label}`,
    { ...localeEnv(locale), MAESTRO_OTP: code },
    { secrets: [code], privateOutput: true }
  )
  log('signed-in', {
    account: label,
    authUserId: account.authUserId,
    appUserId: account.appUserId,
  })
}

const tapCases = {
  // Off-page reply: needs reply pagination before the exact focus.
  warm: { target: 'offPageReply', lifecycle: 'warm' },
  background: { target: 'rootComment', lifecycle: 'background' },
  cold: { target: 'card', lifecycle: 'cold' },
  expired: { target: 'card', lifecycle: 'warm', expired: true },
  unavailable: { target: 'unavailable', lifecycle: 'warm' },
}

async function tap() {
  const name = requireArg('case')
  const spec = tapCases[name]
  if (!spec) throw new Error(`Unknown case ${name}`)
  const locale = args.locale ?? 'en-US'
  const label = `${name}-${locale}`
  const target = state().targets[spec.target]
  const data = notificationData(target, { expired: spec.expired })
  if (platform === 'android') {
    ensureAndroidReverses()
    // Tap cases need presentable notifications; the permission states have their own cases.
    if (!androidPermissionGranted())
      adb('shell', 'pm', 'grant', appId, 'android.permission.POST_NOTIFICATIONS')
  }
  // Every case starts from a stopped app: force-stop also clears earlier notifications, so
  // the shade holds exactly this case's notification and never a group summary.
  stopApp()
  openApp()
  maestro('open-app.yaml', `ready-${label}`, localeEnv('en-US'))
  maestro('set-locale.yaml', `locale-${label}`, localeEnv(locale))
  let finishPush = () => Promise.resolve()
  let iosEnv = {}
  if (platform === 'android') {
    if (spec.lifecycle === 'background') goHome()
    await present(data)
    if (spec.lifecycle === 'cold') await terminateKeepingNotification()
  } else {
    // iOS delivers remote pushes to a terminated app, so end it before the push. The flow
    // itself backgrounds the app and triggers the push.
    if (spec.lifecycle === 'cold') await terminateKeepingNotification()
    const trigger = await present(data)
    finishPush = trigger.finish
    iosEnv = { MAESTRO_PUSH_URL: trigger.url, MAESTRO_LIFECYCLE: spec.lifecycle }
  }
  log('presented', {
    case: name,
    lifecycle: spec.lifecycle,
    notificationId: data.notificationId,
    running: appRunning(),
  })
  const destination =
    spec.expired || spec.target === 'unavailable'
      ? { MAESTRO_EXPECT: 'fallback' }
      : target.commentId
        ? { MAESTRO_EXPECT: 'comment', MAESTRO_TARGET_ID: `comment-${target.commentId}` }
        : {
            MAESTRO_EXPECT: 'card',
            MAESTRO_TARGET_ID: `highlighted-community-card-${target.cardId}`,
          }
  try {
    maestro('community-notification-tap.yaml', label, {
      ...localeEnv(locale),
      ...destination,
      ...iosEnv,
      MAESTRO_PLATFORM: platform,
      MAESTRO_CASE: label,
      MAESTRO_NOTIFICATION_BODY: notificationBody,
    })
  } catch (error) {
    // End the push trigger even when the flow fails, then report the flow failure.
    await finishPush().catch(() => undefined)
    throw error
  }
  await finishPush()
  captureHierarchy(label)
  const result = {
    case: name,
    locale,
    lifecycle: spec.lifecycle,
    data,
    destination,
    passedAt: new Date().toISOString(),
  }
  writeJson(path.join(evidence, `tap-${label}.json`), result)
  log('tapped', result)
}

async function bindings(appUserId) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      'select id, platform, permission, binding_generation from "PushToken" where user_id = $1',
      [appUserId]
    )
    return rows
  })
}

function androidPermissionGranted() {
  const out = adb('shell', 'dumpsys', 'package', appId).stdout
  const line = out
    .split('\n')
    .find((row) => row.includes('android.permission.POST_NOTIFICATIONS: granted='))
  return line?.includes('granted=true') ?? false
}

/**
 * OS permission states, answered in the real OS dialog where one appears:
 * - denied: permission reset to ask, the dialog is answered "Don't allow"
 * - granted: the dialog is answered "Allow"; registration then needs a provider token
 * - revoked: the OS revokes a granted permission (Android kills the process), the app is
 *   reopened and its foreground reconcile runs
 */
async function permission() {
  const name = requireArg('case')
  const owner = state().accounts.recipient
  const locale = args.locale ?? 'en-US'
  const label = `permission-${name}-${locale}`
  if (name !== 'revoked') await disableEngagementNotifications(owner)
  const n = strings[locale].community.notifications
  if (platform === 'ios') return iosPermission(name, owner, locale, label, n)
  ensureAndroidReverses()
  const before = await bindings(owner.appUserId)
  if (name === 'denied') {
    // Back to "ask": clear the user decision so the OS dialog is shown again.
    adb('shell', 'pm', 'revoke', appId, 'android.permission.POST_NOTIFICATIONS')
    adb(
      'shell',
      'pm',
      'clear-permission-flags',
      appId,
      'android.permission.POST_NOTIFICATIONS',
      'user-set',
      'user-fixed'
    )
    openApp()
    maestro('notification-permission.yaml', label, {
      ...localeEnv(locale),
      MAESTRO_DIALOG_CHOICE: 'Don.t allow',
      MAESTRO_EXPECT_TEXT: n.permission,
      MAESTRO_CASE: label,
    })
  } else if (name === 'granted') {
    adb('shell', 'pm', 'revoke', appId, 'android.permission.POST_NOTIFICATIONS')
    adb(
      'shell',
      'pm',
      'clear-permission-flags',
      appId,
      'android.permission.POST_NOTIFICATIONS',
      'user-set',
      'user-fixed'
    )
    openApp()
    maestro('notification-permission.yaml', label, {
      ...localeEnv(locale),
      MAESTRO_DIALOG_CHOICE: 'Allow',
      // Settle on any outcome message; the binding check below is the assertion.
      MAESTRO_EXPECT_TEXT: `${n.saved}|${n.failed}|${n.permission}`,
      MAESTRO_CASE: label,
    })
  } else if (name === 'revoked') {
    if (!androidPermissionGranted())
      throw new Error('Revocation needs a granted permission first')
    adb('shell', 'pm', 'revoke', appId, 'android.permission.POST_NOTIFICATIONS')
    await waitFor('the OS to end the app after revocation', () => !appRunning(), {
      timeout: 15_000,
    })
    openApp()
    maestro('open-app.yaml', label, localeEnv(locale))
    await sleep(5_000)
  } else throw new Error(`Unknown permission case ${name}`)
  captureHierarchy(label)
  const after = await bindings(owner.appUserId)
  const result = {
    case: name,
    locale,
    osPermissionGranted: androidPermissionGranted(),
    bindingsBefore: before,
    bindingsAfter: after,
    at: new Date().toISOString(),
  }
  writeJson(path.join(evidence, `${label}.json`), result)
  log('permission', result)
}

/**
 * iOS asks once per install, so the granted case runs on a fresh install. The system alert is
 * answered in the OS UI. Revocation is not scriptable on the simulator.
 */
async function iosPermission(name, owner, locale, label, n) {
  if (!['granted', 'denied'].includes(name))
    throw new Error(`iOS permission case ${name} is not scriptable`)
  const before = await bindings(owner.appUserId)
  maestro('notification-permission.yaml', label, {
    ...localeEnv(locale),
    MAESTRO_DIALOG_CHOICE: name === 'granted' ? '^Allow$' : 'Don.t Allow',
    MAESTRO_EXPECT_TEXT:
      name === 'granted' ? `${n.saved}|${n.failed}|${n.permission}` : n.permission,
    MAESTRO_CASE: label,
  })
  captureHierarchy(label)
  const after = await bindings(owner.appUserId)
  const result = {
    case: name,
    locale,
    bindingsBefore: before,
    bindingsAfter: after,
    at: new Date().toISOString(),
  }
  writeJson(path.join(evidence, `${label}.json`), result)
  log('permission', result)
}

/** API request log lines (method, path, status) recorded after `since`, in order. */
function apiCallsSince(since) {
  return fs
    .readFileSync(path.join(harness, 'api.log'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"message":"request_completed"'))
    .map((line) => JSON.parse(line))
    .filter((row) => row.timestamp > since)
    .map((row) => ({
      at: row.timestamp,
      method: row.method,
      path: row.path,
      status: row.statusCode,
    }))
}

/**
 * Native session cases (N1):
 * - restore: end the app process, reopen; the secure session restores, Home loads (P2) and
 *   the member's settings render. On iOS the back label is localized (P3).
 * - logout: sign out in the UI; the binding the member held is removed.
 * - switch: sign the second account in over the first; the first member's binding goes.
 * - logout-offline: sign out while the owned API is paused (SIGSTOP on this harness's own
 *   API process), resume it, and record what the pending unbind does on the next start.
 */
async function session() {
  const name = requireArg('case')
  const locale = args.locale ?? 'en-US'
  const label = `session-${name}-${locale}`
  const { recipient, second } = state().accounts
  if (platform === 'android') ensureAndroidReverses()
  const since = new Date().toISOString()
  const owners = async () => ({
    recipient: await bindings(recipient.appUserId),
    second: await bindings(second.appUserId),
  })
  const before = await owners()
  const env = { ...localeEnv(locale), MAESTRO_PLATFORM: platform, MAESTRO_CASE: label }
  // The locale syncs to the profile and persists on the device; select it explicitly.
  if (!appRunning()) openApp()
  maestro('open-app.yaml', `ready-${label}`, localeEnv('en-US'))
  maestro('set-locale.yaml', `locale-${label}`, localeEnv(locale))
  let detail = {}
  if (name === 'restore') {
    stopApp()
    openApp()
    maestro('session-restore.yaml', label, env)
    const calls = apiCallsSince(since)
    const profile = calls.findIndex(
      (c) => c.path === '/api/v1/user/profile' && c.status < 400
    )
    const ritualAfter = calls.slice(profile + 1).find((c) => c.path === '/api/v1/ritual')
    if (profile < 0) throw new Error('No successful profile request after restore')
    // The flow already proved Home rendered without its error state (P2). Home may render
    // from the ritual cache; any network reload after restore must succeed.
    if (ritualAfter && ritualAfter.status >= 400)
      throw new Error(`Home reload failed after restore: ${JSON.stringify(ritualAfter)}`)
    detail = {
      profile: calls[profile],
      homeSource: ritualAfter ? 'network' : 'ritual cache',
      ritualAfterRestore: ritualAfter ?? null,
    }
  } else if (name === 'logout') {
    maestro('session-logout.yaml', label, env)
  } else if (name === 'switch') {
    await signInAccount('second', locale, { fresh: false })
  } else if (name === 'logout-offline') {
    const apiPid = readJson(path.join(harness, 'api-process.json')).pid
    const command = run('ps', ['-p', String(apiPid), '-o', 'command=']).stdout
    if (!command.includes('c-doc/workspace/apps/api/dist/src/main.js'))
      throw new Error('The recorded API process is not this harness API')
    process.kill(apiPid, 'SIGSTOP')
    try {
      maestro('session-logout.yaml', label, env)
    } finally {
      process.kill(apiPid, 'SIGCONT')
    }
    detail.pausedApi = apiPid
    detail.bindingsAfterOfflineLogout = await owners()
    stopApp()
    openApp()
    maestro('open-app.yaml', `${label}-reopen`, env)
    await sleep(5_000)
  } else throw new Error(`Unknown session case ${name}`)
  captureHierarchy(label)
  const result = {
    case: name,
    locale,
    bindingsBefore: before,
    bindingsAfter: await owners(),
    ...detail,
    apiCalls: apiCallsSince(since).filter((c) =>
      /profile|ritual|push|notification-preferences|tokens/.test(c.path)
    ),
    at: new Date().toISOString(),
  }
  writeJson(path.join(evidence, `${label}.json`), result)
  log('session', result)
}

/**
 * Home needs a saved location: without one /ritual answers 400 "No location preferences
 * found" and Home shows its error state. Give the signed-in accounts a location through
 * the product API (as onboarding would) and confirm the ritual loads.
 */
async function locate() {
  const { recipient, second } = state().accounts
  const results = {}
  for (const [label, account] of Object.entries({ recipient, second })) {
    const bearer = await nodeBearer(account)
    const saved = await apiJson('POST', '/api/v1/locations', {
      bearer,
      body: {
        label: 'Chicago',
        locationKey: 'chicago-il',
        latitude: 41.878,
        longitude: -87.63,
        timezone: 'America/Chicago',
        city: 'Chicago',
        region: 'Illinois',
        country: 'United States',
      },
    })
    if (![201, 409].includes(saved.status))
      throw new Error(`Saving a location failed for ${label}: ${saved.status}`)
    const ritual = await apiJson('GET', '/api/v1/ritual?locale=en-US', { bearer })
    if (ritual.status !== 200)
      throw new Error(`Ritual for ${label} answered ${ritual.status}`)
    results[label] = { location: saved.status, ritual: ritual.status }
  }
  log('located', results)
}

/**
 * Permission cases start from engagement notifications off on the server. Turning them on in
 * the UI is what makes the app ask the OS. A preference left on by an earlier case would
 * save without any OS request.
 */
async function disableEngagementNotifications(account) {
  const bearer = await nodeBearer(account)
  const headers = { 'x-couture-platform': 'mobile' }
  const current = await apiJson('GET', '/api/v1/community/notification-preferences', {
    bearer,
    headers,
  })
  if (current.status !== 200)
    throw new Error(`Preferences read answered ${current.status}`)
  if (!current.body.data.enabled) return
  const patched = await apiJson('PATCH', '/api/v1/community/notification-preferences', {
    bearer,
    headers,
    body: { baseRevision: current.body.data.revision, enabled: false },
  })
  if (patched.status !== 200)
    throw new Error(`Preferences update answered ${patched.status}`)
}

const command = args._[0]
checkMaestro()
if (command === 'prepare') await prepare()
else if (command === 'signin') await signin()
else if (command === 'tap') await tap()
else if (command === 'permission') await permission()
else if (command === 'session') await session()
else if (command === 'locate') await locate()
else
  throw new Error('Command must be prepare, locate, signin, tap, permission or session')
