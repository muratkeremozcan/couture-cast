import assert from 'node:assert/strict'
import test from 'node:test'
import { story68FocusObservationHandler } from './story68-ios-focus-observation.mjs'
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
