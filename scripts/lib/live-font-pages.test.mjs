// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00i, every page probed (TEA rulings 2026-11-14): settling a scroll page around one probe
// answer, the scroll-through, and what a capture keeps of it, with the device replaced by
// scripted hierarchy reads and probe answers.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  attachClipImages,
  attachPages,
  MAX_DRAGS,
  PAGE_ATTEMPTS,
  pageImage,
  scrollPages,
  stablePage,
} from './live-font-pages.mjs'

const at = (text, y) => ({ text, id: '', bounds: `[0,${y}][100,${y + 40}]` })
const layout = (name) => ({
  nodes: [at(`${name} top`, 100), at(`${name} bottom`, 900)],
  volatileRegions: [],
  window: '[0,0][1080,2400]',
})

/**
 * A device whose hierarchy reads follow `script` (layout names, the last repeated), and whose
 * probe answers are numbered, logging every read, probe and pause in order.
 */
function device(script) {
  const log = []
  let reads = 0
  let answers = 0
  return {
    log,
    read: () => {
      const name = script[Math.min(reads, script.length - 1)]
      reads += 1
      log.push(`read:${name}`)
      return layout(name)
    },
    probe: () => {
      answers += 1
      log.push(`probe:${answers}`)
      return { token: `answer-${answers}` }
    },
    pause: async () => {
      log.push('pause')
    },
  }
}

describe('stablePage', () => {
  test('asks the probe after two identical reads, then reads once more around its answer', async () => {
    const fake = device(['A', 'B', 'B'])
    const page = await stablePage(fake)
    assert.deepEqual(
      page.nodes.map((node) => node.text),
      ['B top', 'B bottom']
    )
    assert.equal(page.textProbe.token, 'answer-1')
    assert.deepEqual(page.window, '[0,0][1080,2400]')
    assert.deepEqual(fake.log, [
      'read:A',
      'pause',
      'read:B',
      'pause',
      'read:B',
      'probe:1',
      'read:B',
    ])
  })

  test('a page that moves between its read and the probe answer is retried, never paired', async () => {
    // A and A agree, the probe answers, and the read after it shows B: the scroll was still
    // settling, so answer 1 may describe either layout. B then holds around answer 2.
    const fake = device(['A', 'A', 'B', 'B'])
    const page = await stablePage(fake)
    assert.equal(page.textProbe.token, 'answer-2')
    assert.deepEqual(
      page.nodes.map((node) => node.text),
      ['B top', 'B bottom']
    )
    assert.deepEqual(fake.log, [
      'read:A',
      'pause',
      'read:A',
      'probe:1',
      'read:B',
      'pause',
      'read:B',
      'probe:2',
      'read:B',
    ])
  })

  test('a page that never holds still fails as live_font_scroll_page_unstable', async () => {
    const moving = Array.from({ length: 3 * PAGE_ATTEMPTS }, (_, index) => `L${index}`)
    const fake = device(moving)
    await assert.rejects(stablePage(fake), (error) => {
      assert.equal(error.code, 'live_font_scroll_page_unstable')
      assert.match(error.message, /20 reads, 0 probe answers on a moving page/)
      return true
    })
    assert.equal(fake.log.filter((entry) => entry === 'pause').length, PAGE_ATTEMPTS)
    assert.equal(fake.log.filter((entry) => entry.startsWith('probe')).length, 0)
  })

  test('a page that moves at every probe answer fails unstable too, without pairing one', async () => {
    // Each pair of reads agrees, and every read after the probe has moved on.
    const script = []
    for (let index = 0; index < PAGE_ATTEMPTS * 2; index += 1)
      script.push(`P${index}`, `P${index}`)
    const fake = device(script)
    await assert.rejects(stablePage({ ...fake, attempts: 4 }), (error) => {
      assert.equal(error.code, 'live_font_scroll_page_unstable')
      assert.match(error.message, /4 reads, \d+ probe answers on a moving page/)
      return true
    })
    assert.ok(fake.log.filter((entry) => entry.startsWith('probe')).length > 0)
  })
})

// makeCapture hands stablePage the read settleCapture already saw settle.
describe('stablePage with a settled first read', () => {
  test('asks the probe at once and pairs it when the screen held still', async () => {
    const fake = device(['A'])
    const page = await stablePage({ ...fake, first: layout('A') })
    assert.equal(page.textProbe.token, 'answer-1')
    assert.deepEqual(fake.log, ['probe:1', 'read:A'])
  })

  test('a screen that moved at the probe answer is read until it holds and asked again', async () => {
    const fake = device(['B', 'B', 'B'])
    const page = await stablePage({ ...fake, first: layout('A') })
    assert.equal(page.textProbe.token, 'answer-2')
    assert.deepEqual(
      page.nodes.map((node) => node.text),
      ['B top', 'B bottom']
    )
    assert.deepEqual(fake.log, [
      'probe:1',
      'read:B',
      'pause',
      'read:B',
      'probe:2',
      'read:B',
    ])
  })

  test('a screen that never holds after the answer fails unstable', async () => {
    const moving = Array.from({ length: 3 * PAGE_ATTEMPTS }, (_, index) => `M${index}`)
    const fake = device(moving)
    await assert.rejects(stablePage({ ...fake, first: layout('A') }), {
      code: 'live_font_scroll_page_unstable',
    })
    assert.equal(fake.log.filter((entry) => entry.startsWith('probe')).length, 1)
  })
})

describe('scrollPages', () => {
  const pageOf = (name) => ({ ...layout(name), textProbe: { token: name } })

  test('reads one page per drag until a drag shows the same page again', async () => {
    const shown = ['top', 'middle', 'bottom', 'bottom']
    let drags = 0
    const result = await scrollPages({
      page: async () => pageOf(shown[drags]),
      dragUp: () => {
        drags += 1
      },
    })
    assert.deepEqual(
      result.pages.map((page) => page.textProbe.token),
      ['top', 'middle', 'bottom']
    )
    assert.equal(result.drags, 2)
  })

  // Android 6c85bbb4 Community: a feed longer than the cap stopped 13 pages down every time.
  test('a screen still scrolling after maxDrags drags fails as live_font_scroll_bottom_unreached', async () => {
    let drags = 0
    await assert.rejects(
      scrollPages({
        page: async () => pageOf(`page ${drags}`),
        dragUp: () => {
          drags += 1
        },
        maxDrags: 3,
      }),
      { code: 'live_font_scroll_bottom_unreached' }
    )
    assert.equal(drags, 3)
    // A bottom reached on the last drag the cap allows passes.
    const shown = ['top', 'a', 'b', 'b']
    let made = 0
    const result = await scrollPages({
      page: async () => pageOf(shown[made]),
      dragUp: () => {
        made += 1
      },
      maxDrags: 3,
    })
    assert.deepEqual([result.pages.length, result.drags], [3, 2])
  })

  test('the default cap reads a feed of 25 pages to its bottom', async () => {
    assert.ok(MAX_DRAGS >= 25)
    let drags = 0
    const result = await scrollPages({
      page: async () => pageOf(`page ${Math.min(drags, 24)}`),
      dragUp: () => {
        drags += 1
      },
    })
    assert.deepEqual([result.pages.length, result.drags], [25, 24])
  })
})

describe('attachPages', () => {
  test('a screen that scrolls keeps every page with its answer, the shift and the stitched text', () => {
    const first = { ...layout('one'), nodes: [at('A', 100), at('B', 900)], textProbe: {} }
    const second = {
      ...layout('two'),
      nodes: [at('B', 400), at('C', 900)],
      textProbe: {},
    }
    const capture = attachPages({ nodes: first.nodes }, [first, second], 500)
    assert.deepEqual(
      capture.fullText.map((key) => JSON.parse(key)[1]),
      ['A', 'B', 'C']
    )
    assert.deepEqual(capture.pages, [first, second])
    assert.equal(capture.pageShift, 500)
  })

  test('a screen of one page keeps no pages and no stitched text', () => {
    const capture = attachPages({ nodes: [] }, [{ ...layout('one'), textProbe: {} }], 500)
    assert.equal(capture.fullText, undefined)
    assert.equal(capture.pages, undefined)
    assert.equal(capture.pageShift, undefined)
  })
})

// TEA approves entries against screenshots, so every scroll page is shot, inside its settled
// read, and every listed clip names the image of each page it shows on.
describe('page screenshots', () => {
  test('page 0 keeps the capture name; a later page adds its index', () => {
    assert.equal(pageImage('home-007-settled-1.5', 0), 'home-007-settled-1.5.png')
    assert.equal(pageImage('home-007-settled-1.5', 2), 'home-007-settled-1.5-page2.png')
    for (const [file, page] of [
      ['', 0],
      [undefined, 1],
      ['home-007-settled-1.5', -1],
      ['home-007-settled-1.5', 1.5],
    ])
      assert.throws(() => pageImage(file, page), /live_font_page_image/)
  })

  test('the shot is taken once, after the read that follows the answer holds, and kept as the image', async () => {
    const fake = device(['A', 'A', 'B', 'B'])
    let shots = 0
    const page = await stablePage({
      ...fake,
      shoot: () => {
        shots += 1
        fake.log.push('shoot')
        return 'cap-page1.png'
      },
    })
    assert.equal(shots, 1)
    assert.equal(page.image, 'cap-page1.png')
    // Never on the page that moved at answer 1; after answer 2 and the read that confirms it.
    assert.deepEqual(fake.log.slice(-4), ['read:B', 'probe:2', 'read:B', 'shoot'])
    const unshot = await stablePage(device(['A', 'A']))
    assert.equal('image' in unshot, false)
  })

  test('scrollPages hands each page read its index', async () => {
    const indexes = []
    let drags = 0
    await scrollPages({
      page: async (index) => {
        indexes.push(index)
        return { ...layout(['top', 'middle', 'middle'][drags]), textProbe: {} }
      },
      dragUp: () => {
        drags += 1
      },
    })
    assert.deepEqual(indexes, [0, 1, 2])
  })

  test('every listed clip names the screenshot of each page it shows on, by its stage', () => {
    const settled = Object.defineProperty({}, 'file', {
      value: 'settings-020-settled-1.5',
    })
    const updated = Object.defineProperty({}, 'file', {
      value: 'settings-021-updated-1.5',
    })
    const checks = {
      clipping: {
        clipped: [
          { reason: 'clipped_by_layout', key: 'a', pages: [0, 2] },
          { reason: 'outside_parent', text: 'b' },
        ],
      },
      postUpdateClipping: {
        clipped: [{ reason: 'clipped_by_layout', key: 'c', pages: [1] }],
      },
    }
    attachClipImages(checks, { settled, updated })
    assert.deepEqual(
      [...checks.clipping.clipped, ...checks.postUpdateClipping.clipped].map(
        (entry) => entry.images
      ),
      [
        ['settings-020-settled-1.5.png', 'settings-020-settled-1.5-page2.png'],
        ['settings-020-settled-1.5.png'],
        ['settings-021-updated-1.5-page1.png'],
      ]
    )
    // A capture with no file name (a unit fixture) leaves its clips alone.
    const bare = { clipping: { clipped: [{ pages: [0] }] } }
    attachClipImages(bare, { settled: {} })
    assert.equal('images' in bare.clipping.clipped[0], false)
  })
})
