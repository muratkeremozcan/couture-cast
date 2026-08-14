#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EXPO_GO_SDK_54_URL =
  'https://github.com/expo/expo-go-releases/releases/download/Expo-Go-54.0.8/Expo-Go-54.0.8.apk'

/**
 * Where a given APK URL is cached.
 *
 * Keyed on the URL, because the cache below reuses any complete file it finds
 * and `EXPO_GO_APK_URL` can change which APK is wanted. On one fixed path, a
 * run with the override would install the default APK left by the previous run
 * (and the run after it would install the override's), which is the one thing
 * an override exists to prevent. Distinct URLs therefore get distinct files,
 * and each stays reusable.
 *
 * @param {string} url
 * @returns {string}
 */
const cachePathFor = (url) =>
  path.join(
    '/tmp',
    `ExpoGo-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}.apk`
  )

const log = (msg) => console.log(`[expo-go] ${msg}`)
const fail = (msg) => {
  console.error(`[expo-go] ${msg}`)
  process.exit(1)
}

const getAdb = () => {
  const home = process.env.HOME ?? ''
  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(home, 'Library', 'Android', 'sdk')
  const candidate = path.join(sdkRoot, 'platform-tools', 'adb')
  if (fs.existsSync(candidate)) return candidate
  return 'adb'
}

const download = (url, dest, redirectsRemaining = 5) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close(() => {
            fs.unlink(dest, () => undefined)
            if (redirectsRemaining <= 0) {
              reject(new Error('Download failed: too many redirects'))
              return
            }
            const redirectedUrl = new URL(res.headers.location, url).toString()
            download(redirectedUrl, dest, redirectsRemaining - 1).then(resolve, reject)
          })
          return
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Download failed HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            const size = fs.statSync(dest).size
            if (size <= 0) {
              reject(new Error('Download failed: APK file is empty'))
              return
            }
            resolve()
          })
        })
      })
      .on('error', (err) => {
        fs.unlink(dest, () => reject(err))
      })
  })

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
    child.on('error', reject)
  })

const ensureDevice = async (adbPath) => {
  const devices = await new Promise((resolve, reject) => {
    const child = spawn(adbPath, ['devices'], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('exit', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`adb devices exit ${code}`))
    })
    child.on('error', reject)
  })
  const hasDevice = devices.split('\n').some((line) => line.trim().endsWith('\tdevice'))
  if (!hasDevice) fail('No Android emulator/device detected. Boot an emulator first.')
}

/**
 * Whether a file on disk is a complete ZIP archive, which an APK is.
 *
 * A ZIP ends with an end-of-central-directory record whose signature is
 * `PK\x05\x06`, followed by at most 65535 bytes of comment, so it lives inside
 * the last 64KB. A download that was interrupted has a plausible size and no
 * such record.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
const isCompleteApk = (filePath) => {
  if (!fs.existsSync(filePath)) return false
  const size = fs.statSync(filePath).size
  if (size < 22) return false

  const tailLength = Math.min(size, 65_557)
  const tail = Buffer.alloc(tailLength)
  const handle = fs.openSync(filePath, 'r')
  try {
    fs.readSync(handle, tail, 0, tailLength, size - tailLength)
  } finally {
    fs.closeSync(handle)
  }
  return tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== -1
}

const main = async () => {
  const apkUrl = process.env.EXPO_GO_APK_URL || EXPO_GO_SDK_54_URL
  const downloadPath = cachePathFor(apkUrl)

  // Downloaded once per machine, not once per device.
  //
  // A sharded Android run calls this script for every emulator, and the SDK 54
  // APK is about 180MB. Re-fetching it per device pushed the second install past
  // the caller's bound, so a two-emulator run died after installing on exactly
  // one of them. The APK is immutable at its pinned URL, so a complete file on
  // disk is the same bytes.
  //
  // "Complete" has to mean complete. A first attempt at this cache accepted any
  // non-empty file, and the very next run reused the 162MB fragment left behind
  // when the previous download was killed. `adb install` then failed with
  //
  //   Failure [INSTALL_PARSE_FAILED_NOT_APK: Failed to parse ... base.apk]
  //
  // which names the symptom and not the cause. `isCompleteApk` reads the end of
  // the file for the ZIP end-of-central-directory record, which a truncated
  // download cannot have, so the check observes the property it claims.
  if (isCompleteApk(downloadPath)) {
    const size = fs.statSync(downloadPath).size
    log(`Reusing Expo Go APK at ${downloadPath} (${Math.round(size / 1e6)}MB)`)
  } else {
    if (fs.existsSync(downloadPath)) {
      log(`Discarding incomplete Expo Go APK at ${downloadPath}`)
      fs.rmSync(downloadPath, { force: true })
    }
    log(`Downloading Expo Go from ${apkUrl}`)
    await download(apkUrl, downloadPath)
    if (!isCompleteApk(downloadPath)) {
      fail(`Downloaded Expo Go APK at ${downloadPath} is not a complete archive.`)
    }
  }

  const adbPath = getAdb()
  log(`Using adb at: ${adbPath}`)
  await ensureDevice(adbPath)

  log('Installing Expo Go on connected device/emulator')
  await run(adbPath, ['install', '-r', downloadPath])
  log('Expo Go installed successfully')
}

main().catch((err) => fail(err.message))
