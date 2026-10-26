import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import {
  runStory68FallbackFocus,
  recordedIosTest,
  withIosFocusObservation,
} from './story68-fallback-focus.mjs'

test('misrouted fallback preflight closes an older passing record before any native action', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-fallback-preflight-'))
  const records = [{ platform: 'ios', passed: true }]
  let nativeCalls = 0
  try {
    fs.writeFileSync(path.join(directory, 'api.log'), '')
    const ctx = {
      directory,
      platform: 'ios',
      read: () => ({}),
      privateJson: (name, record) => {
        assert.equal(name, 'native-fallback-focus-ios.json')
        records.push(record)
      },
      run: () => nativeCalls++,
      maestro: () => nativeCalls++,
      openUrl: () => nativeCalls++,
    }
    await assert.rejects(runStory68FallbackFocus(ctx))
    assert.equal(nativeCalls, 0)
    assert.equal(records.at(-1).passed, false)
    assert.equal(records.at(-1).code, 'fallback_focus_failed')
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

test('actual asynchronous fallback runner serves UIKit observations while its native child waits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-fallback-observation-'))
  const device = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
  const container = path.join(
    directory,
    `Devices/${device}/data/Containers/Data/Application/owned`
  )
  fs.mkdirSync(path.join(container, 'Documents'), { recursive: true })
  fs.writeFileSync(
    path.join(container, 'Documents/cc68-focus-observation.json'),
    JSON.stringify({
      session: device,
      sequence: 2,
      identifier: 'heading',
      label: 'Community',
      attached: true,
      posted: true,
      header: true,
      headings: ['Community'],
    })
  )
  try {
    await withIosFocusObservation(
      { device, appId: 'com.couturecast.story68', run: () => container },
      async (port) => {
        const log = await recordedIosTest(
          { directory },
          [],
          'child.log',
          (_binary, _args, options) =>
            spawn(
              process.execPath,
              [
                '-e',
                `require('node:http').get('http://127.0.0.1:${port}/focus-observation', response => { let data=''; response.on('data', chunk=>data+=chunk); response.on('end', ()=>{ if(response.statusCode!==200||JSON.parse(data).header!==true)process.exit(2); console.log('actual native child received observed header'); }); }).on('error', ()=>process.exit(3));`,
              ],
              options
            )
        )
        assert.match(log, /actual native child received observed header/)
      },
      0
    )
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})
