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
import { spawnSync } from 'node:child_process'
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
  // An adb transport reset drops reverses, so re-assert the owned ones before each use.
  for (const port of [4077, 8088, 53051]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
}

function openApp() {
  if (platform === 'android') {
    ensureAndroidReverses()
    adb(
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      devClientUrl,
      appId
    )
  } else simctl('openurl', device, devClientUrl)
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
  const out = adb('shell', 'dumpsys', 'notification', '--noredact').stdout
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
  simctl('push', device, appId, payload)
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
  const label = requireArg('account')
  const account = state().accounts[label]
  if (!account) throw new Error(`Unknown account ${label}`)
  const locale = args.locale ?? 'en-US'
  await freshApp()
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
  if (platform === 'android') ensureAndroidReverses()
  if (!appRunning()) openApp()
  maestro('open-app.yaml', `ready-${label}`, localeEnv(locale))
  if (spec.lifecycle === 'background') goHome()
  await present(data)
  if (spec.lifecycle === 'cold') await terminateKeepingNotification()
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
  maestro('../community-notification-tap.yaml', label, {
    ...localeEnv(locale),
    ...destination,
    MAESTRO_PLATFORM: platform,
    MAESTRO_CASE: label,
    MAESTRO_NOTIFICATION_BODY: notificationBody,
  })
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
  if (platform !== 'android')
    throw new Error('iOS permission states use simctl privacy; not wired yet')
  const owner = state().accounts.recipient
  const locale = args.locale ?? 'en-US'
  const label = `permission-${name}-${locale}`
  const n = strings[locale].community.notifications
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

const command = args._[0]
checkMaestro()
if (command === 'prepare') await prepare()
else if (command === 'signin') await signin()
else if (command === 'tap') await tap()
else if (command === 'permission') await permission()
else throw new Error('Command must be prepare, signin, tap or permission')
