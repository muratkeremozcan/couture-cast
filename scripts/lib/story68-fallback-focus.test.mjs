import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runStory68FallbackFocus } from './story68-fallback-focus.mjs'

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
