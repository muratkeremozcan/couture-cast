import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { METRO_RUNNING, expoStatusUrl, waitForExpoStatus } from './expo-dev-server.mjs'

test('the readiness probe asks /status and never renders the web page', async (t) => {
  const paths = []
  const server = createServer((req, res) => {
    paths.push(req.url)
    if (req.url === '/status') res.end(METRO_RUNNING)
    else setTimeout(() => res.end('<html>'), 5_000)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const started = Date.now()
  await waitForExpoStatus(base, 5_000, 100)
  assert.ok(Date.now() - started < 1_000)
  assert.deepEqual(paths, ['/status'])
  assert.equal(expoStatusUrl(`${base}/`), `${base}/status`)
})

test('a server that answers something else is not Metro, and the wait ends', async (t) => {
  const server = createServer((_req, res) => res.end('not metro'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  await assert.rejects(
    waitForExpoStatus(`http://127.0.0.1:${server.address().port}`, 300, 100),
    /not running before 300 ms/
  )
})

test('the Maestro runner asks the dev server only through /status', () => {
  const runner = readFileSync(new URL('../run-maestro.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(runner, /waitForHealth\(pair\.health/)
  assert.equal(runner.match(/waitForExpoStatus\(pair\.health/g)?.length, 2)
})
