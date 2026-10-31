// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
/** Real installer CLI, controlled HTTP redirects/streams, isolated cache and synthetic ADB. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const installer = path.resolve('scripts/install-expo-go.mjs')
const apk = Buffer.from(zipSync({ 'AndroidManifest.xml': strToU8('synthetic manifest') }))
// Accepted CLI contract: follow at most five redirects after the initial request.
const MAX_REDIRECTS = 5
let directory: string
let server: http.Server
let requests: string[]
let respond: (request: http.IncomingMessage, response: http.ServerResponse) => void
let base: string

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-go-installer-'))
  requests = []
  respond = (_request, response) => response.end(apk)
  server = http.createServer((request, response) => {
    requests.push(request.url ?? '/')
    respond(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server not bound')
  base = `https://127.0.0.1:${address.port}`
  fs.mkdirSync(path.join(directory, 'sdk/platform-tools'), { recursive: true })
  fs.mkdirSync(path.join(directory, 'cache'))
  fs.writeFileSync(
    path.join(directory, 'sdk/platform-tools/adb'),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.INSTALLER_TEST_ADB_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'devices') console.log('List of devices attached\\nemulator-first\\tdevice\\nemulator-selected\\tdevice');
`,
    { mode: 0o755 }
  )
  fs.writeFileSync(
    path.join(directory, 'preload.mjs'),
    `import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
// Keep the CLI/network/stream/ADB boundaries real; redirect only HTTPS transport and its cache.
https.get = (url, callback) => http.get(String(url).replace(/^https:/, 'http:'), callback);
const cache = process.env.INSTALLER_TEST_CACHE;
const map = (value) => typeof value === 'string' && /^\\/tmp\\/ExpoGo-[0-9a-f]+\\.apk$/.test(value) ? path.join(cache, path.basename(value)) : value;
for (const name of ['existsSync', 'statSync', 'openSync', 'rmSync', 'readFileSync']) {
  const original = fs[name].bind(fs);
  fs[name] = (file, ...args) => original(map(file), ...args);
}
for (const name of ['rm', 'stat']) {
  const original = fs.promises[name].bind(fs.promises);
  fs.promises[name] = (file, ...args) => original(map(file), ...args);
}
let delayedUnlink, unlinkTimer;
const unlink = fs.unlink.bind(fs);
fs.unlink = (file, callback) => {
  if (process.env.INSTALLER_TEST_DELAY_UNLINK === 'true') {
    delayedUnlink = () => {
      clearTimeout(unlinkTimer);
      unlink(map(file), (error) => {
        fs.appendFileSync(process.env.INSTALLER_TEST_EVENTS, 'controlled redirect unlink\\n');
        callback(error);
      });
    };
    // Awaited cleanup can finish before recursion; eager recursion forces unlink after its open.
    unlinkTimer = setTimeout(() => { const run = delayedUnlink; delayedUnlink = undefined; run?.(); }, 100);
  } else unlink(map(file), callback);
};
const create = fs.createWriteStream.bind(fs);
fs.createWriteStream = (file, ...args) => {
  const target = process.env.INSTALLER_TEST_WRITE_ERROR === 'true' ? path.join(cache, 'absent', path.basename(file)) : map(file);
  if (delayedUnlink) clearTimeout(unlinkTimer);
  const stream = create(target, ...args);
  stream.once('open', () => { const run = delayedUnlink; delayedUnlink = undefined; run?.(); });
  return stream;
};
`
  )
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  fs.rmSync(directory, { recursive: true, force: true })
})

function cacheFile(url: string): string {
  return path.join(
    directory,
    'cache',
    `ExpoGo-${createHash('sha256').update(url).digest('hex').slice(0, 12)}.apk`
  )
}

function run(
  url: string,
  options: { delayedUnlink?: boolean; writeError?: boolean } = {}
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [installer], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(path.join(directory, 'preload.mjs')).href}`,
          ANDROID_HOME: path.join(directory, 'sdk'),
          ANDROID_SERIAL: 'emulator-selected',
          EXPO_GO_APK_URL: url,
          INSTALLER_TEST_CACHE: path.join(directory, 'cache'),
          INSTALLER_TEST_ADB_CALLS: path.join(directory, 'adb.jsonl'),
          INSTALLER_TEST_EVENTS: path.join(directory, 'events.txt'),
          INSTALLER_TEST_DELAY_UNLINK: String(options.delayedUnlink === true),
          INSTALLER_TEST_WRITE_ERROR: String(options.writeError === true),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      child.once('error', reject)
      child.once('close', (code) => resolve({ code, stdout, stderr }))
    }
  )
}

function adbCalls(): string[][] {
  const file = path.join(directory, 'adb.jsonl')
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : []
}

describe('Expo Go installer CLI download ownership', () => {
  it('survives redirect cleanup overtaking a slow final stream, then reuses only the complete URL cache on the selected device', async () => {
    const url = `${base}/redirect`
    fs.writeFileSync(cacheFile(url), 'truncated previous download')
    respond = (request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/apk' }).end()
        return
      }
      response.writeHead(200, { 'Content-Length': apk.length })
      response.write(apk.subarray(0, 8))
      setTimeout(() => response.end(apk.subarray(8)), 50)
    }
    const first = await run(url, { delayedUnlink: true })
    expect(first.code, first.stderr).toBe(0)
    expect(first.stdout).toContain('Discarding incomplete Expo Go APK')
    expect(fs.readFileSync(cacheFile(url))).toEqual(apk)
    expect(requests).toEqual(['/redirect', '/apk'])
    const second = await run(url, { delayedUnlink: true })
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toContain('Reusing Expo Go APK')
    expect(requests).toEqual(['/redirect', '/apk'])
    expect(adbCalls()).toEqual([
      ['devices'],
      [
        '-s',
        'emulator-selected',
        'install',
        '-r',
        `/tmp/${path.basename(cacheFile(url))}`,
      ],
      ['devices'],
      [
        '-s',
        'emulator-selected',
        'install',
        '-r',
        `/tmp/${path.basename(cacheFile(url))}`,
      ],
    ])
  })

  it('rejects HTTP failures without leaving a reusable APK or invoking ADB', async () => {
    respond = (_request, response) => response.writeHead(503).end('synthetic failure')
    const result = await run(`${base}/unavailable`)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Download failed HTTP 503')
    expect(fs.readdirSync(path.join(directory, 'cache'))).toEqual([])
    expect(adbCalls()).toEqual([])
  })

  it('removes an interrupted response even if its received bytes contain a complete ZIP marker', async () => {
    respond = (_request, response) => {
      response.writeHead(200, { 'Content-Length': apk.length + 10 })
      response.write(apk)
      setTimeout(() => response.destroy(), 30)
    }
    const result = await run(`${base}/interrupted`)
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/aborted|premature close/i)
    expect(fs.readdirSync(path.join(directory, 'cache'))).toEqual([])
    expect(adbCalls()).toEqual([])
  })

  it('handles a destination stream error without an uncaught exception or invoking ADB', async () => {
    const result = await run(`${base}/write-failure`, { writeError: true })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/\[expo-go\].*ENOENT/)
    expect(result.stderr).not.toContain('Unhandled')
    expect(fs.readdirSync(path.join(directory, 'cache'))).toEqual([])
    expect(adbCalls()).toEqual([])
  })

  it('bounds redirect loops without opening cache files or invoking ADB', async () => {
    respond = (_request, response) => response.writeHead(302, { Location: '/loop' }).end()
    const result = await run(`${base}/loop`)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('too many redirects')
    expect(requests).toHaveLength(MAX_REDIRECTS + 1)
    expect(fs.readdirSync(path.join(directory, 'cache'))).toEqual([])
    expect(adbCalls()).toEqual([])
  })
})
