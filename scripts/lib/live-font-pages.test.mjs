// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00i, every page probed (TEA rulings 2026-11-14): settling a scroll page around one probe
// answer, the scroll-through, and what a capture keeps of it, with the device replaced by
// scripted hierarchy reads and probe answers.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  attachPages,
  PAGE_ATTEMPTS,
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

  test('stops after maxDrags drags on a screen that keeps scrolling', async () => {
    let drags = 0
    const result = await scrollPages({
      page: async () => pageOf(`page ${drags}`),
      dragUp: () => {
        drags += 1
      },
      maxDrags: 3,
    })
    assert.equal(result.pages.length, 4)
    assert.equal(result.drags, 3)
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
