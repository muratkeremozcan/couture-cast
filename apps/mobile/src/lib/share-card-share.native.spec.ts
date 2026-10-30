import { Platform } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError, decodeShareCardBase64 } from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { sha256Hex } from './share-card-digest'
const mocks = vi.hoisted(() => ({
  files: new Map<string, { bytes: string; modified: number }>(),
  write: vi.fn(),
  remove: vi.fn(),
  prepare: vi.fn(),
  shareFile: vi.fn(),
  moduleAvailable: true,
  fixture: 'real',
  substitute: undefined as unknown,
  uuid: 0,
  clock: 1_800_000_000_000,
  order: [] as string[],
}))
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: () => Promise.resolve(),
  writeAsStringAsync: mocks.write,
  deleteAsync: mocks.remove,
  getInfoAsync: (uri: string) => {
    if (uri.endsWith('/')) return Promise.resolve({ exists: true, isDirectory: true })
    const file = mocks.files.get(uri)
    return Promise.resolve(
      file
        ? { exists: true, isDirectory: false, modificationTime: file.modified / 1000 }
        : { exists: false }
    )
  },
  readDirectoryAsync: () =>
    Promise.resolve([...mocks.files.keys()].map((uri) => uri.split('/').at(-1))),
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
    crypto.subtle.digest('SHA-256', bytes),
  randomUUID: () => `00000000-0000-4000-8000-${String(++mocks.uuid).padStart(12, '0')}`,
}))
vi.mock('../../modules/share-card-native-share', () => ({
  shareCardNativeShareModule: () =>
    mocks.moduleAvailable ? { shareFile: mocks.shareFile } : null,
}))
vi.mock('./share-card-native-fixture', () => ({
  shareCardFixtureMode: () => mocks.fixture,
  runShareCardNativeShare: (share: () => Promise<unknown>) =>
    mocks.substitute === undefined ? share() : Promise.resolve(mocks.substitute),
}))
vi.mock('./share-cards', () => ({ prepareShareCardFromMobile: mocks.prepare }))
import {
  nativeShareCardShareAvailable,
  shareShareCard,
  sweepExpiredShareCardFiles,
  validateShareCardShareResult,
  SHARE_CARD_SHARE_LEASE_MS,
} from './share-card-share.native'
import {
  commitShareCardSave,
  liveShareCardFiles,
  nativeShareCardSavePending,
} from './share-card-save-operations'

const directory = 'file:///cache/share-cards/'
const shareFile = /^file:\/\/\/cache\/share-cards\/cc69-share-[a-f0-9-]+\.png$/
const input = {
  source: { kind: 'outfit', recommendationId: 'owned-outfit' },
  locale: 'en-US',
  watermark: true,
  expectedSha256: card.sha256,
} as const
const anchor = { x: 12, y: 640, width: 320, height: 48 }
const originalOS = Platform.OS
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
}
function options(overrides: Partial<Parameters<typeof shareShareCard>[1]> = {}) {
  return {
    signal: new AbortController().signal,
    isCurrent: () => true,
    anchor: () => {
      mocks.order.push('anchor')
      return Promise.resolve(anchor)
    },
    ...overrides,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
/** The same PNG with one IDAT byte changed and its CRC recomputed: valid framing, new digest. */
function tamperedPngBase64(base64: string) {
  const bytes = decodeShareCardBase64(base64)
  const view = new DataView(bytes.buffer)
  let offset = 8
  while (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) !== 'IDAT')
    offset += 12 + view.getUint32(offset)
  const size = view.getUint32(offset)
  bytes[offset + 8] = bytes[offset + 8]! ^ 0xff
  let crc = 0xffffffff
  for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  view.setUint32(offset + 8 + size, (crc ^ 0xffffffff) >>> 0)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const shareFiles = () => [...mocks.files.keys()].filter((uri) => shareFile.test(uri))
beforeEach(() => {
  setOS('ios')
  mocks.files.clear()
  mocks.order.length = 0
  mocks.uuid = 0
  mocks.moduleAvailable = true
  mocks.fixture = 'real'
  mocks.substitute = undefined
  mocks.prepare.mockReset().mockImplementation(() => {
    mocks.order.push('prepare')
    return Promise.resolve(card)
  })
  mocks.write.mockReset().mockImplementation((uri: string, bytes: string) => {
    mocks.order.push('write')
    mocks.files.set(uri, { bytes, modified: Date.now() })
    return Promise.resolve()
  })
  mocks.remove.mockReset().mockImplementation((uri: string) => {
    mocks.order.push(`remove:${uri.split('/').at(-1)}`)
    mocks.files.delete(uri)
    return Promise.resolve()
  })
  mocks.shareFile.mockReset().mockImplementation(() => {
    mocks.order.push('shareFile')
    return Promise.resolve({ target: 'instagram', outcome: 'completed' })
  })
})
afterEach(() => {
  setOS(originalOS)
  vi.restoreAllMocks()
})

describe('U-SHARE-LIB-BYTES: only the previewed bytes reach the share sheet', () => {
  it('reauthorizes with the share purpose and hands over a cc69-share file hashing to the preview digest', async () => {
    expect(await shareShareCard(input, options())).toEqual({
      target: 'instagram',
      outcome: 'completed',
    })
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
      { ...input, purpose: 'share' },
      expect.any(AbortSignal)
    )
    const [uri, digest, passedAnchor] = mocks.shareFile.mock.calls[0] as [
      string,
      string,
      unknown,
    ]
    expect(uri).toMatch(shareFile)
    expect(digest).toBe(card.sha256)
    expect(passedAnchor).toEqual(anchor)
    const written = mocks.files.get(uri)!.bytes
    expect(await sha256Hex(decodeShareCardBase64(written))).toBe(card.sha256)
    expect(mocks.order).toEqual(['prepare', 'write', 'anchor', 'shareFile'])
  })
  it('a response digest that differs from the preview writes nothing and calls no module', async () => {
    mocks.prepare.mockResolvedValue({ ...card, sha256: 'f'.repeat(64) })
    await expect(shareShareCard(input, options())).rejects.toThrow('previewChanged')
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.shareFile).not.toHaveBeenCalled()
  })
  it('decoded bytes that differ from the response digest write nothing and call no module', async () => {
    const tampered = tamperedPngBase64(card.pngBase64)
    mocks.prepare.mockResolvedValue({ ...card, pngBase64: tampered })
    await expect(shareShareCard(input, options())).rejects.toThrow('render')
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.shareFile).not.toHaveBeenCalled()
  })
  it('a fixture result still runs the real authorization and the real write', async () => {
    setOS('android')
    mocks.substitute = { target: 'pinterest', outcome: 'target_chosen' }
    expect(await shareShareCard(input, options())).toEqual({
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(shareFiles()).toHaveLength(1)
    expect(mocks.shareFile).not.toHaveBeenCalled()
  })
  it('an anchor that cannot be measured hands off with no anchor', async () => {
    await shareShareCard(
      input,
      options({ anchor: () => Promise.reject(new Error('unmounted')) })
    )
    expect(mocks.shareFile.mock.calls[0]?.[2]).toBeNull()
  })
})

describe('U-SHARE-LIB-RESULT: the strict bridge validator', () => {
  it.each([
    ['ios', { target: 'instagram', outcome: 'completed' }],
    ['ios', { target: 'unknown', outcome: 'completed' }],
    ['ios', { target: 'other', outcome: 'completed' }],
    ['ios', { target: 'pinterest', outcome: 'cancelled' }],
    ['ios', { target: 'none', outcome: 'cancelled' }],
    ['ios', { target: 'none', outcome: 'failed', code: 'presenter_unavailable' }],
    ['android', { target: 'pinterest', outcome: 'target_chosen' }],
    ['android', { target: 'other', outcome: 'target_chosen' }],
    ['android', { target: 'none', outcome: 'not_confirmed' }],
    ['android', { target: 'none', outcome: 'failed', code: 'start_failed' }],
    ['android', { target: 'none', outcome: 'unavailable', code: 'chooser_unavailable' }],
  ])('%s accepts %j', (os, result) => {
    expect(validateShareCardShareResult(result, os)).toEqual(result)
  })
  it.each([
    ['android completed', 'android', { target: 'instagram', outcome: 'completed' }],
    ['android cancelled', 'android', { target: 'none', outcome: 'cancelled' }],
    ['iOS target_chosen', 'ios', { target: 'pinterest', outcome: 'target_chosen' }],
    ['iOS not_confirmed', 'ios', { target: 'none', outcome: 'not_confirmed' }],
    ['android unknown', 'android', { target: 'unknown', outcome: 'target_chosen' }],
    ['android unknown none', 'android', { target: 'unknown', outcome: 'not_confirmed' }],
    ['failed with an app', 'ios', { target: 'instagram', outcome: 'failed' }],
    ['closed with an app', 'android', { target: 'facebook', outcome: 'not_confirmed' }],
    [
      'activityType key',
      'ios',
      {
        target: 'instagram',
        outcome: 'completed',
        activityType: 'com.burbn.instagram.shareextension',
      },
    ],
    [
      'package key',
      'android',
      { target: 'other', outcome: 'target_chosen', package: 'com.example.app' },
    ],
    [
      'uri key',
      'ios',
      { target: 'none', outcome: 'cancelled', uri: 'file:///cache/share-cards/x.png' },
    ],
    [
      'raw package target',
      'android',
      { target: 'com.pinterest', outcome: 'target_chosen' },
    ],
    ['open code', 'ios', { target: 'none', outcome: 'failed', code: 'NSError 42' }],
    ['handed_off', 'ios', { target: 'unknown', outcome: 'handed_off' }],
    ['web client', 'web', { target: 'unknown', outcome: 'handed_off' }],
    ['null', 'ios', null],
    ['array', 'ios', ['instagram', 'completed']],
    ['string', 'android', 'target_chosen'],
  ])('%s settles as failed/none invalid_result', (_name, os, result) => {
    expect(validateShareCardShareResult(result, os)).toEqual({
      target: 'none',
      outcome: 'failed',
      code: 'invalid_result',
    })
  })
  it('a bridge result outside the model settles the attempt as failed/none', async () => {
    setOS('android')
    mocks.shareFile.mockResolvedValue({
      target: 'instagram',
      outcome: 'completed',
      package: 'com.instagram.android',
    })
    expect(await shareShareCard(input, options())).toEqual({
      target: 'none',
      outcome: 'failed',
      code: 'invalid_result',
    })
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('a rejected bridge call settles as failed/none native_error and releases the lock', async () => {
    mocks.shareFile.mockRejectedValue(new Error('bridge'))
    expect(await shareShareCard(input, options())).toEqual({
      target: 'none',
      outcome: 'failed',
      code: 'native_error',
    })
    expect(nativeShareCardSavePending()).toBe(false)
  })
})

describe('U-SHARE-LEASE: the 30-minute handoff lease', () => {
  const now = mocks.clock
  const plant = (name: string, ageMs: number) => {
    mocks.files.set(directory + name, { bytes: 'x', modified: now - ageMs })
    return directory + name
  }
  it('settlement releases the lock while the handed-off file stays on disk', async () => {
    const native = deferred<unknown>()
    mocks.shareFile.mockReturnValue(native.promise)
    const pending = shareShareCard(input, options())
    await vi.waitFor(() => expect(mocks.shareFile).toHaveBeenCalledOnce())
    expect(nativeShareCardSavePending()).toBe(true)
    native.resolve({ target: 'none', outcome: 'cancelled' })
    await pending
    expect(nativeShareCardSavePending()).toBe(false)
    expect(liveShareCardFiles().size).toBe(0)
    expect(shareFiles()).toHaveLength(1)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('an identity change after handoff ignores nothing on disk: the leased file stays', async () => {
    let current = true
    mocks.shareFile.mockImplementation(() => {
      current = false
      return Promise.resolve({ target: 'pinterest', outcome: 'cancelled' })
    })
    await shareShareCard(input, options({ isCurrent: () => current }))
    expect(shareFiles()).toHaveLength(1)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('a superseded attempt before handoff deletes its unused file and calls no module', async () => {
    let current = true
    mocks.write.mockImplementation((uri: string, bytes: string) => {
      mocks.files.set(uri, { bytes, modified: Date.now() })
      current = false
      return Promise.resolve()
    })
    await expect(
      shareShareCard(input, options({ isCurrent: () => current }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.shareFile).not.toHaveBeenCalled()
    expect(shareFiles()).toHaveLength(0)
  })
  it('the age sweep deletes expired and future-dated share files only', async () => {
    const young = plant('cc69-share-00000000-0000-4000-8000-000000000001.png', 5 * 60_000)
    const edge = plant(
      'cc69-share-00000000-0000-4000-8000-000000000002.png',
      SHARE_CARD_SHARE_LEASE_MS
    )
    const old = plant('cc69-share-00000000-0000-4000-8000-000000000003.png', 31 * 60_000)
    const future = plant('cc69-share-00000000-0000-4000-8000-000000000004.png', -60_000)
    const save = plant('cc68-00000000-0000-4000-8000-000000000005.png', 24 * 3_600_000)
    const foreign = plant('cc69-share-notes.txt', 24 * 3_600_000)
    await sweepExpiredShareCardFiles(now)
    expect(mocks.files.has(young)).toBe(true)
    expect(mocks.files.has(edge)).toBe(false)
    expect(mocks.files.has(old)).toBe(false)
    expect(mocks.files.has(future)).toBe(false)
    expect(mocks.files.has(save)).toBe(true)
    expect(mocks.files.has(foreign)).toBe(true)
  })
  it('a restart keeps a file younger than the lease', async () => {
    const leased = plant(
      'cc69-share-00000000-0000-4000-8000-000000000006.png',
      SHARE_CARD_SHARE_LEASE_MS - 1
    )
    await sweepExpiredShareCardFiles(now)
    expect(mocks.files.has(leased)).toBe(true)
    await sweepExpiredShareCardFiles(now + 1)
    expect(mocks.files.has(leased)).toBe(false)
  })
  it('the sweep runs before each share, ahead of authorization', async () => {
    const expired = directory + 'cc69-share-00000000-0000-4000-8000-0000000000aa.png'
    mocks.files.set(expired, { bytes: 'x', modified: Date.now() - 31 * 60_000 })
    await shareShareCard(input, options())
    expect(mocks.files.has(expired)).toBe(false)
    expect(mocks.order.indexOf(`remove:${expired.split('/').at(-1)}`)).toBeLessThan(
      mocks.order.indexOf('prepare')
    )
  })
  it('the sweep never deletes the live handoff file', async () => {
    const native = deferred<unknown>()
    mocks.shareFile.mockReturnValue(native.promise)
    const pending = shareShareCard(input, options())
    await vi.waitFor(() => expect(mocks.shareFile).toHaveBeenCalledOnce())
    const live = shareFiles()[0]!
    await sweepExpiredShareCardFiles(Date.now() + 2 * SHARE_CARD_SHARE_LEASE_MS)
    expect(mocks.files.has(live)).toBe(true)
    native.resolve({ target: 'none', outcome: 'cancelled' })
    await pending
  })
})

describe('U-SHARE-OPS and U-SHARE-LIB-UNAVAILABLE', () => {
  it('a pending save blocks a share before any authorization', async () => {
    const native = deferred<void>()
    const saving = commitShareCardSave({
      fileUri: `${directory}cc68-pending.png`,
      save: () => native.promise,
      cleanup: () => Promise.resolve(),
    })
    await expect(shareShareCard(input, options())).rejects.toThrow('finishingSave')
    expect(mocks.prepare).not.toHaveBeenCalled()
    native.resolve()
    await saving
  })
  it.each([
    ['module absent', () => (mocks.moduleAvailable = false)],
    ['fixture static absence', () => (mocks.fixture = 'unavailable')],
    ['web platform', () => setOS('web')],
  ])('%s: unavailable, no prepare request and no file', async (_name, arrange) => {
    arrange()
    expect(nativeShareCardShareAvailable()).toBe(false)
    await expect(shareShareCard(input, options())).rejects.toThrow(
      'nativeShareUnavailable'
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('a present module is available on iOS and Android', () => {
    expect(nativeShareCardShareAvailable()).toBe(true)
    setOS('android')
    expect(nativeShareCardShareAvailable()).toBe(true)
  })
  it('a runtime start error the module reports settles as unavailable/none', async () => {
    setOS('android')
    mocks.shareFile.mockResolvedValue({
      target: 'none',
      outcome: 'unavailable',
      code: 'chooser_unavailable',
    })
    expect(await shareShareCard(input, options())).toEqual({
      target: 'none',
      outcome: 'unavailable',
      code: 'chooser_unavailable',
    })
  })
})

describe('U-SHARE-LOG-PRIVACY: failure logs carry closed codes only', () => {
  const secret = `file:///cache/share-cards/cc69-share-1234.png ${card.sha256} com.instagram.android`
  const logged = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.map((call) => call.join(' ')).join('\n')
  it.each([
    [
      'bridge rejection',
      '[cc69-share] native_error',
      () => mocks.shareFile.mockRejectedValue(new Error(secret)),
    ],
    [
      'invalid result',
      '[cc69-share] invalid_result',
      () =>
        mocks.shareFile.mockResolvedValue({
          target: 'other',
          outcome: 'completed',
          activityType: secret,
        }),
    ],
    [
      'write error',
      '[cc69-share] error',
      () => mocks.write.mockRejectedValue(new Error(secret)),
    ],
    [
      'prepare 403',
      '[cc69-share] forbidden',
      () =>
        mocks.prepare.mockRejectedValue(
          new ResponseError(new Response(secret, { status: 403 }))
        ),
    ],
    [
      'prepare 409',
      '[cc69-share] preview_changed',
      () =>
        mocks.prepare.mockRejectedValue(
          new ResponseError(new Response(secret, { status: 409 }))
        ),
    ],
    [
      'offline',
      '[cc69-share] offline',
      () => mocks.prepare.mockRejectedValue(new Error('offline')),
    ],
  ])('%s logs %s', async (_name, expected, arrange) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    arrange()
    await shareShareCard(input, options()).catch(() => undefined)
    expect(logged(warn)).toBe(expected)
    expect(logged(warn)).not.toMatch(/file:|com\.|[a-f0-9]{64}|cc69-share-\d/)
  })
})
