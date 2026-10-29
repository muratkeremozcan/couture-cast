import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { decodeShareCardBase64 } from '@couture/api-client'
import { sha256Hex } from './share-card-digest'
import * as fallback from './share-card-save'
import * as browserFixture from './share-card-native-fixture'
const observe = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('../../modules/accessibility-focus', () => ({
  enableStory68FocusObservation: observe,
}))
const environment = vi.hoisted(() => ({
  app: 'com.couturecast.story68',
  enabled: true,
  exists: true,
  listener: null as null | ((event: { url: string }) => void),
}))
vi.mock('expo-application', () => ({
  get applicationId() {
    return environment.app
  },
}))
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: { story68NativeFixtures: environment.enabled } }
    },
  },
}))
vi.mock('expo-linking', () => ({
  addEventListener: (_name: string, listener: (event: { url: string }) => void) => {
    environment.listener = listener
    return {
      remove: () => {
        environment.listener = null
      },
    }
  },
}))
vi.mock('expo-file-system/legacy', () => ({
  getInfoAsync: () => Promise.resolve({ exists: environment.exists }),
}))
import * as nativeFixture from './share-card-native-fixture.native'
import {
  isShareCardNativeFixtureBuild,
  isShareCardNativeFixtureUrl,
} from './share-card-native-fixture-url'
const mode = (value: string) =>
  environment.listener?.({
    url: `couturecast-story68://__story68__/share-card?mode=${value}`,
  })
beforeEach(() => {
  vi.stubGlobal('__DEV__', true)
  environment.app = 'com.couturecast.story68'
  environment.enabled = true
  environment.exists = true
  nativeFixture.startShareCardNativeFixture()
  mode('real')
})
afterEach(() => {
  environment.listener = null
  vi.unstubAllGlobals()
})
describe('isolated native fixtures and browser boundaries', () => {
  it('enables read-only native observations only inside the owned Debug fixture and disarms on cleanup', () => {
    observe.mockClear()
    const stop = nativeFixture.startShareCardNativeFixture()
    expect(observe).toHaveBeenCalledWith()
    stop()
    expect(observe).toHaveBeenLastCalledWith(false)
    for (const gate of ['flag', 'release']) {
      observe.mockClear()
      environment.enabled = gate !== 'flag'
      vi.stubGlobal('__DEV__', gate !== 'release')
      nativeFixture.startShareCardNativeFixture()()
      expect(observe).not.toHaveBeenCalled()
    }
  })
  it.each(['flag', 'production'])(
    'fixture activation requires isolated identity, flag and development build: %s',
    (gate) => {
      if (gate === 'flag') environment.enabled = false
      if (gate === 'production') vi.stubGlobal('__DEV__', false)
      const stop = nativeFixture.startShareCardNativeFixture()
      mode('storage')
      expect(nativeFixture.shareCardFixtureMode()).toBe('real')
      expect(nativeFixture.shareCardPreviewTestId(true, card.sha256)).toBe(
        'share-card-preview-loaded'
      )
      stop()
    }
  )
  it('default and absent application identities cannot activate isolated native fixtures', () => {
    expect(isShareCardNativeFixtureBuild(true, 'com.couturecast.app', true)).toBe(false)
    expect(isShareCardNativeFixtureBuild(true, null, true)).toBe(false)
    expect(isShareCardNativeFixtureBuild(false, 'com.couturecast.story68', true)).toBe(
      false
    )
    expect(isShareCardNativeFixtureBuild(true, 'com.couturecast.story68', 'true')).toBe(
      false
    )
    expect(isShareCardNativeFixtureBuild(true, 'com.couturecast.story68', true)).toBe(
      true
    )
  })
  it('fixture URL boundary rejects other hosts/routes/schemes and unknown modes', () => {
    for (const url of [
      'bad url',
      'https://__story68__/share-card',
      'couturecast-story68://other/share-card',
      'couturecast-story68://__story68__/other',
    ])
      expect(isShareCardNativeFixtureUrl(url)).toBe(false)
    expect(
      isShareCardNativeFixtureUrl(
        'couturecast-story68://__story68__/share-card?mode=real'
      )
    ).toBe(true)
    environment.listener?.({ url: 'https://__story68__/share-card?mode=storage' })
    mode('unknown')
    expect(nativeFixture.shareCardFixtureMode()).toBe('real')
    expect(nativeFixture.shareCardPreviewTestId(false, card.sha256)).toBe(
      'share-card-preview'
    )
    expect(nativeFixture.shareCardPreviewTestId(true, card.sha256)).toContain(card.sha256)
  })
  it('a deferred preparation is released explicitly or cancelled without a late result', async () => {
    mode('prepare_deferred')
    const abort = new AbortController()
    const cancelled = nativeFixture.waitShareCardNativePreparation(abort.signal)
    abort.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const allowed = nativeFixture.waitShareCardNativePreparation(
      new AbortController().signal
    )
    mode('release')
    await expect(allowed).resolves.toBeUndefined()
    mode('real')
    await expect(
      nativeFixture.waitShareCardNativePreparation(new AbortController().signal)
    ).resolves.toBeUndefined()
    await expect(
      browserFixture.waitShareCardNativePreparation(new AbortController().signal)
    ).resolves.toBeUndefined()
  })
  it('authorization-only delay leaves previews live and cancels a held save before release', async () => {
    mode('authorization_deferred')
    const signal = new AbortController()
    await expect(
      nativeFixture.waitShareCardNativePreparation(signal.signal, 'preview')
    ).resolves.toBeUndefined()
    let settled = false
    const save = nativeFixture.waitShareCardNativePreparation(signal.signal, 'save')
    void save.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    signal.abort()
    await expect(save).rejects.toMatchObject({ name: 'AbortError' })
    mode('release')
    const allowed = nativeFixture.waitShareCardNativePreparation(
      new AbortController().signal,
      'save'
    )
    mode('release')
    await expect(allowed).resolves.toBeUndefined()
    environment.enabled = false
    mode('authorization_deferred')
    await expect(
      nativeFixture.waitShareCardNativePreparation(new AbortController().signal, 'save')
    ).resolves.toBeUndefined()
    await expect(
      browserFixture.waitShareCardNativePreparation(new AbortController().signal, 'save')
    ).resolves.toBeUndefined()
  })
  it('limited response still invokes the real native adapter; storage rejection never imports', async () => {
    const save = vi.fn(() => Promise.resolve())
    mode('limited')
    await nativeFixture.runShareCardNativeAdapter('file:///owned.png', save)
    expect(save).toHaveBeenCalledOnce()
    mode('storage')
    await expect(
      nativeFixture.runShareCardNativeAdapter('file:///owned.png', save)
    ).rejects.toThrow('storage')
    expect(save).toHaveBeenCalledOnce()
  })
  it.each([true, false])(
    'deferred late native read validates file lifetime before import: exists=%s',
    async (exists) => {
      const save = vi.fn(() => Promise.resolve())
      mode('deferred')
      const pending = nativeFixture.runShareCardNativeAdapter('file:///owned.png', save)
      expect(save).not.toHaveBeenCalled()
      environment.exists = exists
      const assertion = exists
        ? expect(pending).resolves.toBeUndefined()
        : expect(pending).rejects.toThrow('pending_file_missing')
      mode('release')
      await assertion
      expect(save).toHaveBeenCalledTimes(exists ? 1 : 0)
      nativeFixture.startShareCardNativeFixture()()
      expect(environment.listener).toBeNull()
    }
  )
  it('browser save fallback never activates native saving', async () => {
    expect(fallback.nativeShareCardSaveAvailable()).toBe(false)
    expect(await fallback.shareCardSavePermission(true)).toMatchObject({ granted: false })
    await fallback.cleanOrphanShareCards()
    await expect(
      fallback.saveShareCard(card, new AbortController().signal, () => true)
    ).rejects.toThrow('nativeSaveUnavailable')
  })
  it('browser fixture module stays in real mode and passes the adapter through', async () => {
    expect(browserFixture.shareCardFixtureMode()).toBe('real')
    browserFixture.startShareCardNativeFixture()()
    expect(browserFixture.shareCardPreviewTestId(false, '')).toBe('share-card-preview')
    expect(browserFixture.shareCardPreviewTestId(true, '')).toBe(
      'share-card-preview-loaded'
    )
    const save = vi.fn(() => Promise.resolve())
    await browserFixture.runShareCardNativeAdapter('', save)
    expect(save).toHaveBeenCalledOnce()
  })
  it('portable digest matches the fixture sha256 for the exact decoded bytes', async () => {
    expect(await sha256Hex(decodeShareCardBase64(card.pngBase64))).toBe(card.sha256)
  })
})

describe('opener trace recorder', () => {
  it('writes closed events with ms offsets, bounded and in order', async () => {
    const writes: { uri: string; contents: string }[] = []
    let clock = 1000
    const record = nativeFixture.openerTraceRecorder(
      'file:///docs/',
      (uri, contents) => {
        writes.push({ uri, contents })
        return Promise.resolve()
      },
      () => (clock += 7)
    )
    record('press')
    record('state-open')
    for (let index = 0; index < 45; index++) record('composer-idle')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      writes.every((write) => write.uri === 'file:///docs/cc68-opener-trace.json')
    ).toBe(true)
    const last = JSON.parse(writes.at(-1)?.contents ?? '{}')
    expect(last.version).toBe(1)
    expect(last.events).toHaveLength(40)
    expect(last.events.at(-1).e).toBe('composer-idle')
    const first = JSON.parse(writes[0]?.contents ?? '{}')
    expect(first.events).toEqual([{ e: 'press', t: 7 }])
  })

  it('records a sign-in input length as a bounded count and drops anything else', async () => {
    const writes: string[] = []
    const record = nativeFixture.openerTraceRecorder(
      'file:///docs/',
      (_uri, contents) => {
        writes.push(contents)
        return Promise.resolve()
      },
      () => 1
    )
    record('signin-code-change', 6)
    record('signin-code-change', 4000)
    record('signin-code-change', -1)
    record('signin-code-change', 1.5)
    record('signin-code-focus')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const events = JSON.parse(writes.at(-1) ?? '{}').events
    expect(events.map((event: { n?: number }) => event.n)).toEqual([
      6,
      99,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('stays silent without a documents directory and survives a failed write', async () => {
    const quiet = nativeFixture.openerTraceRecorder(null, () =>
      Promise.reject(new Error('x'))
    )
    expect(() => quiet('press')).not.toThrow()
    const failing = nativeFixture.openerTraceRecorder('file:///docs/', () =>
      Promise.reject(new Error('disk'))
    )
    expect(() => failing('press')).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
