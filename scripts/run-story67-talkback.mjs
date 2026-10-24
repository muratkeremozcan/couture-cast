#!/usr/bin/env node
// Story 6.7 owner: device evidence that the Home teaser moves real TalkBack focus.

/**
 * Drives the Home spotlight teaser on an Android development build that carries the local
 * accessibility-focus module, with TalkBack running, against an owned Story 6.5-style
 * harness (isolated API on 4077, Metro on 8088, local Auth proxy on 53051).
 *
 * Every command takes --harness <dir> and --label <name>; evidence lands in
 * <harness>/native/android-talkback/<label>.
 *
 *   signin   --account <label>  real sign-in UI; the runner types through adb
 *   return   --account <label>  sign in, activate the teaser, TalkBack, Android back to Home
 *   fallback --account <label>  sign in, activate, sign out (identity change), TalkBack,
 *                               back to Home
 *
 * The proof is the `home-spotlight-teaser-focused-<target>-1` marker. It renders only after
 * the OS reported accessibility focus on the requested target through the module, so a build
 * whose focus call is suppressed never shows it. The focus-requested marker only shows that
 * the request reached a real node.
 *
 * Expo Go cannot load the module and CI has no development-build lane, so this is local
 * evidence; the Expo Go flows keep running in CI and assert the request marker.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAESTRO_PINNED_VERSION } from './maestro-version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flows = path.join(root, 'maestro', 'story67')
const appId = 'com.couturecast.story65'
// Tools come from the environment: ADB or the Android SDK, MAESTRO_BIN, else PATH.
const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
const adbPath =
  process.env.ADB ?? (androidSdk ? path.join(androidSdk, 'platform-tools', 'adb') : 'adb')
const maestroPath = process.env.MAESTRO_BIN ?? 'maestro'
const talkBack =
  'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService'

const args = parseArgs(process.argv.slice(2))
const harness = path.resolve(requireArg('harness'))
const device = args.device ?? 'emulator-5554'
const label = requireArg('label')
const evidence = path.join(harness, 'native', 'android-talkback', label)
fs.mkdirSync(evidence, { recursive: true })

const owned = readJson(path.join(harness, 'owned-env.json'))
if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(owned.DATABASE_URL).pathname))
  throw new Error('An isolated UUID database is required.')
const authHarness = readJson(path.join(harness, 'auth-harness.json'))
const english = readJson(path.join(root, 'apps/mobile/assets/locales/en-US.json'))

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

function log(event, detail = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail })
  console.log(line)
  fs.appendFileSync(path.join(evidence, 'events.jsonl'), `${line}\n`)
}

function run(command, commandArgs, { allowFail = false } = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' })
  if (!allowFail && result.status !== 0)
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr}`)
  return result
}

const adb = (...rest) => run(adbPath, ['-s', device, ...rest])

/** Polls `probe` until it returns a value, failing after `timeout`. */
async function waitFor(description, probe, { timeout = 30_000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

function ensureReverses() {
  run(adbPath, ['-s', device, 'wait-for-device'])
  for (const port of [4077, 8088, 53051, 54321])
    adb('reverse', `tcp:${port}`, `tcp:${port}`)
}

function strings() {
  const n = english.community.notifications
  return {
    MAESTRO_TITLE: n.title,
    MAESTRO_SIGNIN: n.signin,
    MAESTRO_SEND: n.sendCode,
    MAESTRO_VERIFY: n.verify,
    MAESTRO_CODE_SENT: n.codeSent,
    MAESTRO_EMAIL_LABEL: n.email,
    MAESTRO_CODE_LABEL: n.code,
    MAESTRO_ENABLED: n.enabled,
    MAESTRO_SIGNOUT: n.signout,
  }
}

function checkMaestro() {
  const version = run(maestroPath, ['--version']).stdout.trim().split('\n').pop()
  if (version !== MAESTRO_PINNED_VERSION)
    throw new Error(
      `Maestro ${version} does not match the pinned ${MAESTRO_PINNED_VERSION}`
    )
}

/** Runs one flow and keeps its output under the evidence tree; `secrets` are redacted. */
function maestro(flow, step, { env = {}, secrets = [], allowFail = false } = {}) {
  const output = path.join(evidence, 'maestro', step)
  fs.mkdirSync(output, { recursive: true })
  ensureReverses()
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
    {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
        MAESTRO_APP_ID: appId,
        MAESTRO_CLI_NO_ANALYTICS: '1',
        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
        ...strings(),
        ...env,
      },
    }
  )
  let text = `${result.stdout}\n${result.stderr}`
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
  fs.writeFileSync(path.join(evidence, `maestro-${step}.log`), text)
  log('maestro', { flow, step, status: result.status })
  if (result.status !== 0 && !allowFail)
    throw new Error(`Maestro flow ${flow} failed (${step})`)
  return result.status === 0
}

/**
 * Types into the focused field through adb. One long `input text` loses characters
 * while the controlled TextInput re-renders, so the text goes in short chunks.
 */
function typeText(text) {
  if (!/^[\w.@+-]+$/.test(text)) throw new Error('Unsupported characters for adb input')
  for (let start = 0; start < text.length; start += 6)
    adb('shell', 'input', 'text', text.slice(start, start + 6))
}

function openApp() {
  ensureReverses()
  // The Expo Go lanes share this emulator; a task Expo Go left behind can surface over
  // the development build.
  adb('shell', 'am', 'force-stop', 'host.exp.exponent')
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
}

function talkBackRunning() {
  const services = adb(
    'shell',
    'settings',
    'get',
    'secure',
    'enabled_accessibility_services'
  )
  const exploring = adb('shell', 'settings', 'get', 'secure', 'touch_exploration_enabled')
  return services.stdout.includes(talkBack) && exploring.stdout.trim() === '1'
}

async function setTalkBack(on) {
  if (on) {
    // Maestro's driver keeps a UiAutomation connection after a flow ends, and while it is
    // connected the app's AccessibilityManager reports touch exploration off, so
    // View.requestAccessibilityFocus refuses every request. No flow runs while TalkBack is on.
    for (const driver of ['dev.mobile.maestro.test', 'dev.mobile.maestro'])
      adb('shell', 'am', 'force-stop', driver)
    // TalkBack asks for notifications on its first start, and that prompt takes the window.
    adb(
      'shell',
      'pm',
      'grant',
      talkBack.split('/')[0],
      'android.permission.POST_NOTIFICATIONS'
    )
    adb('shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', talkBack)
    adb('shell', 'settings', 'put', 'secure', 'accessibility_enabled', '1')
    await waitFor('TalkBack to start touch exploration', talkBackRunning)
  } else {
    adb('shell', 'settings', 'delete', 'secure', 'enabled_accessibility_services')
    adb('shell', 'settings', 'put', 'secure', 'accessibility_enabled', '0')
    await waitFor('TalkBack to stop', () => !talkBackRunning())
  }
  log('talkback', { on })
}

function otpFile(email) {
  return path.join(
    authHarness.otpDir,
    `${createHash('sha256').update(email).digest('hex')}.json`
  )
}

async function signin() {
  const account = readJson(path.join(harness, 'native', 'android', 'state.json'))
    .accounts[requireArg('account')]
  if (!account) throw new Error(`Unknown account ${args.account}`)
  adb('shell', 'am', 'force-stop', appId)
  openApp()
  maestro('../story65/open-app.yaml', 'signin-open')
  maestro('signin-email.yaml', 'signin-email')
  typeText(account.email)
  const since = Date.now()
  maestro('signin-code.yaml', 'signin-code', { env: { MAESTRO_EMAIL: account.email } })
  const code = await waitFor('an owned OTP', () => {
    try {
      const value = readJson(otpFile(account.email))
      return value.issuedAt >= since && /^\d{6,10}$/.test(value.code) ? value.code : null
    } catch {
      return null
    }
  })
  typeText(code)
  maestro('signin-verify.yaml', 'signin-verify', { secrets: [code] })
  log('signed-in', { account: args.account, appUserId: account.appUserId })
}

/** Where the confirmed marker for `target` lands; the label names the run. */
async function expectLanded(target, step) {
  await settle()
  // TalkBack turns single-finger swipes into its own gestures, so the marker is read after
  // it stops. The marker is state: it records an OS focus report already received.
  await setTalkBack(false)
  const landed = maestro('teaser-focus-landed.yaml', step, {
    env: { MAESTRO_TARGET: target },
    allowFail: true,
  })
  log('focus-landed', { target, landed, label })
  if (!landed) throw new Error(`No OS-confirmed focus on the ${target}`)
}

/**
 * Lets TalkBack and the app finish a transition. Nothing can watch for it: every
 * UiAutomation client (Maestro, `uiautomator dump`) suspends TalkBack while it is
 * connected, and with it the app's touch exploration that accessibility focus needs.
 * The assertion that follows reads recorded state, so a short wait only bounds when.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 4_000))
}

async function back() {
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  log('back')
}

async function returnCase() {
  await setTalkBack(false)
  await signin()
  // Back from the notification settings screen sign-in ends on, to the tabs.
  maestro('../story65/open-app.yaml', 'return-tabs')
  maestro('teaser-open.yaml', 'return-activate')
  await setTalkBack(true)
  await back()
  await expectLanded('link', 'return-landed')
}

async function fallbackCase() {
  await setTalkBack(false)
  // The case ends signed out, so it starts by signing in.
  await signin()
  // Back from the notification settings screen sign-in ends on, to the tabs.
  maestro('../story65/open-app.yaml', 'fallback-tabs')
  maestro('teaser-open.yaml', 'fallback-activate')
  // The identity change: sign out through the product UI while Community is up.
  maestro('teaser-signout.yaml', 'fallback-signout')
  await setTalkBack(true)
  // From the Settings tab root, Android back goes Home.
  await back()
  await expectLanded('scroll-view', 'fallback-landed')
}

checkMaestro()
const command = args._[0]
const commands = { signin, return: returnCase, fallback: fallbackCase }
if (!commands[command]) throw new Error(`Unknown command ${command}`)
await commands[command]()
