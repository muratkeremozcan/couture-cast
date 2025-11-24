#!/usr/bin/env node

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { spawn } from 'node:child_process'

const API_URL = 'https://api.expo.dev/v2/versions/latest'
const FALLBACK_URL = 'https://github.com/expo/expo-go-releases/releases/download/Expo-Go-54.0.6/Expo-Go-54.0.6.apk'
const DOWNLOAD_PATH = path.join('/tmp', 'ExpoGo-latest.apk')

const log = (msg) => console.log(`[expo-go] ${msg}`)
const warn = (msg) => console.warn(`[expo-go] ${msg}`)
const fail = (msg) => {
  console.error(`[expo-go] ${msg}`)
  process.exit(1)
}

const getAdb = () => {
  const home = process.env.HOME ?? ''
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(home, 'Library', 'Android', 'sdk')
  const candidate = path.join(sdkRoot, 'platform-tools', 'adb')
  if (fs.existsSync(candidate)) return candidate
  return 'adb'
}

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })

const download = (url, dest) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Download failed HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
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
  const hasDevice = devices
    .split('\n')
    .some((line) => line.trim().endsWith('\tdevice'))
  if (!hasDevice) fail('No Android emulator/device detected. Boot an emulator first.')
}

const main = async () => {
  log('Fetching latest Expo Go URL')
  let apkUrl = FALLBACK_URL
  try {
    const json = await fetchJson(API_URL)
    const url = json?.data?.androidClientUrl
    if (url) apkUrl = url
  } catch (err) {
    warn(`Falling back to pinned Expo Go APK: ${err.message}`)
  }

  log(`Downloading Expo Go from ${apkUrl}`)
  await download(apkUrl, DOWNLOAD_PATH)

  const adbPath = getAdb()
  log(`Using adb at: ${adbPath}`)
  await ensureDevice(adbPath)

  log('Installing Expo Go on connected device/emulator')
  await run(adbPath, ['install', '-r', DOWNLOAD_PATH])
  log('Expo Go installed successfully')
}

main().catch((err) => fail(err.message))
