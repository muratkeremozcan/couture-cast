// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  iosAppContainerReader,
  story68FocusObservationHandler,
} from './story68-ios-focus-observation.mjs'
const device = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
const container = `/Users/test/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Data/Application/owned`
const record = {
  session: '11111111-2222-3333-4444-555555555555',
  sequence: 3,
  identifier: 'share-card-title',
  label: 'Card',
  posted: true,
  attached: true,
  header: true,
  headings: ['Card'],
}
function request(options = {}, url = '/focus-observation', method = 'GET') {
  const accesses = []
  const handler = story68FocusObservationHandler({
    device,
    appId: 'com.couturecast.story68',
    readContainer: () => container,
    readFile: (file) => {
      accesses.push(file)
      return JSON.stringify({ ...record, privateExtra: 'must drop' })
    },
    ...options,
  })
  const response = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      return this
    },
    end(body) {
      this.body = body
    },
  }
  return { handled: handler({ url, method }, response), accesses, response }
}

describe('story68FocusObservationHandler', () => {
  test('read-only focus endpoint retrieves only the exact owned simulator record and closed fields', () => {
    const result = request()
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.accesses, [
      `${container}/Documents/cc68-focus-observation.json`,
    ])
    assert.deepEqual(JSON.parse(result.response.body), record)
    assert.equal(result.response.headers['Cache-Control'], 'no-store')
  })

  test('focus endpoint refuses mutation and unrelated routes before any container read', () => {
    for (const [url, method, handled, status] of [
      ['/focus-observation', 'POST', true, 405],
      ['/fixture?mode=real', 'GET', false, undefined],
    ]) {
      const result = request({}, url, method)
      assert.equal(result.handled, handled)
      assert.equal(result.response.status, status)
      assert.deepEqual(result.accesses, [])
    }
  })

  test('focus reader rejects foreign identity, misrouted container, missing and malformed records', () => {
    assert.throws(
      () => story68FocusObservationHandler({ device, appId: 'com.couturecast.app' }),
      /owned_ios/
    )
    for (const options of [
      { readContainer: () => '/tmp/foreign' },
      {
        readFile: () => {
          throw new Error('missing')
        },
      },
      { readFile: () => JSON.stringify({ ...record, header: 'true' }) },
      { readFile: () => JSON.stringify({ ...record, sequence: -1 }) },
    ])
      assert.equal(request(options).response.status, 503)
  })
})

describe('story68FocusObservationHandler async container lookup', () => {
  test('answers once an asynchronous container lookup resolves, and 503 when it rejects', async () => {
    const answer = async (readContainer) => {
      const result = request({ readContainer })
      assert.equal(result.handled, true)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return result.response
    }
    const ok = await answer(async () => container)
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), record)
    const refused = await answer(async () => {
      throw new Error('simctl_failed')
    })
    assert.equal(refused.status, 503)
  })
})

describe('iosAppContainerReader', () => {
  test('one lookup answers concurrent and later reads without blocking the event loop', async () => {
    let calls = 0
    let release
    const read = iosAppContainerReader({
      device,
      appId: 'com.couturecast.story68',
      lookup: () => {
        calls++
        return new Promise((resolve) => (release = () => resolve(container)))
      },
    })
    const first = read()
    const second = read()
    // A timer still fires while the lookup is outstanding: nothing holds the loop.
    await new Promise((resolve) => setTimeout(resolve, 1))
    release()
    assert.deepEqual(await Promise.all([first, second]), [container, container])
    assert.equal(await read(), container)
    assert.equal(calls, 1)
  })

  test('the default simctl lookup leaves the event loop free while simctl is slow', async (t) => {
    // A stand-in xcrun that answers after 400 ms, like simctl on a starved host.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-xcrun-'))
    fs.writeFileSync(
      path.join(bin, 'xcrun'),
      `#!/bin/sh\nsleep 0.4\necho '${container}'\n`,
      { mode: 0o755 }
    )
    const savedPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`
    t.after(() => {
      process.env.PATH = savedPath
      fs.rmSync(bin, { recursive: true, force: true })
    })
    const read = iosAppContainerReader({ device, appId: 'com.couturecast.story68' })
    let ticks = 0
    const timer = setInterval(() => ticks++, 20)
    try {
      assert.equal((await read()).trim(), container)
    } finally {
      clearInterval(timer)
    }
    assert.ok(ticks >= 5, `the event loop ran ${ticks} timer ticks during the lookup`)
  })

  test('a failed lookup is forgotten so the next read asks again', async () => {
    let calls = 0
    const read = iosAppContainerReader({
      device,
      appId: 'com.couturecast.story68',
      lookup: async () => {
        calls++
        if (calls === 1) throw new Error('simctl_unavailable')
        return container
      },
    })
    await assert.rejects(read(), /simctl_unavailable/)
    assert.equal(await read(), container)
    assert.equal(calls, 2)
  })

  test('the handler serves a warmed container without another lookup', async () => {
    let calls = 0
    const read = iosAppContainerReader({
      device,
      appId: 'com.couturecast.story68',
      lookup: async () => {
        calls++
        return container
      },
    })
    await read()
    const response = await new Promise((resolve) => {
      const result = {
        writeHead(status) {
          this.status = status
          return this
        },
        end() {
          resolve(this)
        },
      }
      story68FocusObservationHandler({
        device,
        appId: 'com.couturecast.story68',
        readContainer: read,
        readFile: () => JSON.stringify(record),
      })({ url: '/focus-observation', method: 'GET' }, result)
    })
    assert.equal(response.status, 200)
    assert.equal(calls, 1)
  })
})
