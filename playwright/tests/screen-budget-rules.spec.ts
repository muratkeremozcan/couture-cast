// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-RULE-001..051, the coverage of record for
// packages/utils/src/screen-budget-measure.ts (spec P8: it needs a layout engine, so the utils
// node coverage excludes it). Every rule runs on an inline page with a passing control and a
// failing one, so a measure that sees nothing cannot pass (risk R1).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import type { Page } from '@playwright/test'
import {
  measureScreenBudget,
  type ScreenBudgetMeasureConfig,
  type ScreenBudgetMeasurement,
} from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  analyticsOnly,
  probeErrors,
  probeScreen,
  type ProbeResult,
} from '../support/helpers/screen-budget-probe'

const GOLD = '212 175 55'
const CARD = '255 255 255'
const CARD_MUTED = '245 243 238'
const SHADOW = '0 1px 3px rgba(17, 17, 17, 0.12)'

/** The app's token shape: channels in variables, read through rgb(var(--...)) (spec P4). */
const PAGE = (body: string, css = '') => `<!doctype html>
<html><head><style>
  :root { --cc-primary: ${GOLD}; --cc-card: ${CARD}; --cc-card-muted: ${CARD_MUTED}; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/24px sans-serif; background: rgb(240 239 233); color: #111; }
  button, a { font: inherit; }
  .btn { display: inline-block; height: 44px; padding: 0 16px; border: 1px solid #444;
         background: transparent; border-radius: 8px; }
  .gold { background: rgb(var(--cc-primary)); }
  .pill { display: inline-block; height: 36px; padding: 0 14px; border-radius: 9999px;
          border: 1px solid #444; background: transparent; }
  .row { display: flex; gap: 8px; }
  .card { background: rgb(var(--cc-card)); border-radius: 12px; padding: 16px; min-height: 80px; }
  .muted { background: rgb(var(--cc-card-muted)); border-radius: 12px; padding: 12px;
           min-height: 70px; }
  .shadowed { background: transparent; box-shadow: ${SHADOW}; border-radius: 12px;
              padding: 16px; min-height: 80px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
             overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .w200 { width: 200px; }
  ${css}
</style></head><body>${body}</body></html>`

const CONFIG: ScreenBudgetMeasureConfig = {
  viewport: { width: 390, height: 844 },
  tabBarSelectors: ['[data-testid="tab-bar"]'],
  tileSelectors: ['[data-testid^="garment-card-"]', '[data-testid^="community-card-"]'],
  tokens: {
    primary: 'rgb(var(--cc-primary))',
    card: 'rgb(var(--cc-card))',
    cardMuted: 'rgb(var(--cc-card-muted))',
    cardShadow: SHADOW,
  },
  minCardSizePx: 64,
}

async function measure(
  page: Page,
  body: string,
  options: { css?: string; config?: Partial<ScreenBudgetMeasureConfig> } = {}
): Promise<ScreenBudgetMeasurement> {
  await page.setContent(PAGE(body, options.css))
  const result = await page.evaluate(measureScreenBudget, {
    ...CONFIG,
    ...options.config,
  })
  // A token that did not resolve would silently zero the primary and card rules (R1).
  expect(result.errors).toEqual([])
  return result
}

const keys = (elements: readonly { key: string }[]) => elements.map((el) => el.key).sort()
const buttons = (count: number, prefix = 't') =>
  Array.from(
    { length: count },
    (_, i) => `<button class="btn" data-testid="${prefix}${i + 1}">Go ${i + 1}</button>`
  ).join('')

test.describe('CC-7.10 screen budget measure rules @local-lane', () => {
  test.use({ authSessionEnabled: false, viewport: { width: 390, height: 844 } })

  test('[P0] [7.10-RULE-001] targets above the fold: seven count 7, an eighth counts 8, one at top 844 is below the fold', async ({
    page,
  }) => {
    const seven = await measure(page, buttons(7))
    expect(seven.targetsAboveFold).toHaveLength(7)
    const eight = await measure(page, buttons(8))
    expect(eight.targetsAboveFold).toHaveLength(8)
    const fold = await measure(
      page,
      `${buttons(7)}<div style="position:absolute;top:844px;left:0"><button class="btn" data-testid="below">Below</button></div>`
    )
    expect(keys(fold.targetsAboveFold)).not.toContain('below')
    expect(fold.targetsAboveFold).toHaveLength(7)
    const edge = await measure(
      page,
      '<div style="position:absolute;top:843px;left:0"><button class="btn" data-testid="edge">Edge</button></div>'
    )
    expect(keys(edge.targetsAboveFold)).toEqual(['edge'])
  })

  test('[P0] [7.10-RULE-002] targets in the tab bar and inside tiles are excluded and reported in stats', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<button class="btn" data-testid="own">Own</button>
       <div data-testid="garment-card-1"><a href="/g/1">Tee</a><button class="btn">Edit</button></div>
       <div data-testid="community-card-1"><a href="/p/1">Look</a></div>
       <nav data-testid="tab-bar" style="position:fixed;bottom:0;left:0;right:0">
         <a href="/">Today</a><a href="/wardrobe">Closet</a><a href="/community">Community</a>
       </nav>`
    )
    expect(keys(result.targetsAboveFold)).toEqual(['own'])
    expect(result.stats.tabBarTargets).toBe(3)
    expect(result.stats.tileTargets).toBe(3)
  })

  test('[P1] [7.10-RULE-003] a button inside a link counts once; the label of an sr-only file input counts as one target', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<a href="/x" data-testid="outer" style="display:block;padding:8px"><button class="btn">Inner</button></a>
       <label for="upload" data-testid="upload-label" class="btn">Upload</label>
       <input id="upload" type="file" class="sr-only">`
    )
    expect(keys(result.targetsAboveFold)).toEqual(['outer', 'upload-label'])
  })

  test('[P0] [7.10-RULE-004] not counted: sr-only skip link, aria-hidden and inert subtrees, opacity 0, visibility hidden, clipped by an overflow ancestor, off to the right of a scroller', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<a href="#main" class="sr-only">Skip to content</a>
       <div aria-hidden="true"><button class="btn">Hidden subtree</button></div>
       <div inert><button class="btn">Inert subtree</button></div>
       <button class="btn" style="opacity:0">Transparent</button>
       <div style="opacity:0"><button class="btn">Transparent parent</button></div>
       <button class="btn" style="visibility:hidden">Invisible</button>
       <div style="height:0;overflow:hidden"><button class="btn">Collapsed panel</button></div>
       <div class="row" style="width:390px;overflow-x:auto">
         <button class="btn" data-testid="first" style="flex:0 0 390px">First</button>
         <button class="btn" data-testid="offscreen" style="flex:0 0 300px">Offscreen</button>
       </div>
       <button class="btn" data-testid="visible">Visible</button>`
    )
    expect(keys(result.targetsAboveFold)).toEqual(['first', 'visible'])
  })

  test('[P1] [7.10-RULE-005] disabled and aria-disabled buttons still count', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<button class="btn" data-testid="d1" disabled>Disabled</button>
       <button class="btn" data-testid="d2" aria-disabled="true">Aria disabled</button>`
    )
    expect(keys(result.targetsAboveFold)).toEqual(['d1', 'd2'])
  })

  test('[P1] [7.10-RULE-006] role and tabindex targets count; tabindex -1 and plain text do not', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div role="tab" data-testid="r-tab" class="btn">Tab</div>
       <div role="switch" aria-checked="false" data-testid="r-switch" class="btn">Switch</div>
       <div role="menuitem" data-testid="r-menuitem" class="btn">Item</div>
       <div role="option" data-testid="r-option" class="btn">Option</div>
       <div tabindex="0" data-testid="r-focusable" class="btn">Focusable</div>
       <div tabindex="-1" data-testid="r-programmatic" class="btn">Programmatic</div>
       <div data-testid="r-text" class="btn">Text</div>`
    )
    expect(keys(result.targetsAboveFold)).toEqual(
      ['r-focusable', 'r-menuitem', 'r-option', 'r-switch', 'r-tab'].sort()
    )
  })

  test('[P0] [7.10-RULE-010] one gold primary; a second anywhere, below the fold too, is reported with both keys', async ({
    page,
  }) => {
    const one = await measure(
      page,
      '<button class="btn gold" data-testid="p1">Save</button>'
    )
    expect(keys(one.primaryButtons)).toEqual(['p1'])
    const two = await measure(
      page,
      `<button class="btn gold" data-testid="p1">Save</button>
       <div style="height:2000px"></div>
       <a href="/x" class="btn gold" data-testid="p2">Also gold</a>`
    )
    expect(keys(two.primaryButtons)).toEqual(['p1', 'p2'])
  })

  test('[P1] [7.10-RULE-010b] a gold target inside a gold target counts once (TEA review M2)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<a href="/x" class="gold" data-testid="outer-gold" style="display:block;padding:8px"><span role="button" tabindex="0" class="btn gold">Go</span></a>
       <a href="/y" data-testid="plain-card" style="display:block;padding:8px"><button class="btn gold" data-testid="inner-gold">Go</button></a>`
    )
    expect(keys(result.primaryButtons)).toEqual(['inner-gold', 'outer-gold'])
  })

  test('[P0] [7.10-RULE-011] primary follows the live CSS variable; a near-gold one channel off is not primary', async ({
    page,
  }) => {
    const live = await measure(
      page,
      '<button class="btn gold" data-testid="themed">Save</button>',
      { css: ':root { --cc-primary: 120 80 200; }' }
    )
    expect(keys(live.primaryButtons)).toEqual(['themed'])
    const near = await measure(
      page,
      '<button class="btn" data-testid="near" style="background: rgb(212 175 54)">Near</button>'
    )
    expect(near.primaryButtons).toEqual([])
  })

  test('[P0] [7.10-RULE-011b] a token that does not resolve is an error, never a silent zero', async ({
    page,
  }) => {
    await page.setContent(PAGE('<button class="btn gold">Save</button>'))
    const result = await page.evaluate(measureScreenBudget, {
      ...CONFIG,
      tokens: { ...CONFIG.tokens, primary: 'rgb(var(--cc-missing))' },
    })
    expect(result.errors.join('\n')).toContain('token primary did not resolve')
  })

  test('[P1] [7.10-RULE-012] a primary inside a tile still counts (P1)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      '<div data-testid="garment-card-1"><button class="btn gold" data-testid="tile-gold">Use</button></div>'
    )
    expect(keys(result.primaryButtons)).toEqual(['tile-gold'])
  })

  test('[P0] [7.10-RULE-020] one chip row of pressed pills; a second row is reported as its own row', async ({
    page,
  }) => {
    const chipRow = (id: string) =>
      `<div class="row" role="group" data-testid="${id}">
         <button class="pill" aria-pressed="true">All</button>
         <button class="pill" aria-pressed="false">Tops</button>
         <button class="pill" aria-pressed="false">Shoes</button>
       </div>`
    const one = await measure(page, chipRow('row-a'))
    expect(keys(one.chipRows)).toEqual(['row-a'])
    const two = await measure(page, chipRow('row-a') + chipRow('row-b'))
    expect(keys(two.chipRows)).toEqual(['row-a', 'row-b'])
  })

  // Link chips mark only the active one (aria-current); the row counts when it holds two pills
  // and one of them carries a selection state (TEA review M3).
  test('[P1] [7.10-RULE-021] chips wrapped in li under one flex list are one row; a scrolled row with chips off screen still counts (P2)', async ({
    page,
  }) => {
    const wrapped = await measure(
      page,
      `<ul class="row" data-testid="li-row" style="list-style:none;margin:0;padding:0">
         <li><a href="/a" class="pill" aria-current="page">Today</a></li>
         <li><a href="/b" class="pill">Week</a></li>
       </ul>`
    )
    expect(keys(wrapped.chipRows)).toEqual(['li-row'])
    const scrolled = await measure(
      page,
      `<div class="row" data-testid="scroll-row" style="width:390px;overflow-x:auto">
         <button class="pill" aria-pressed="true" style="flex:0 0 200px">One</button>
         <button class="pill" aria-pressed="false" style="flex:0 0 200px">Two</button>
         <button class="pill" aria-pressed="false" style="flex:0 0 200px">Three</button>
       </div>`
    )
    expect(scrolled.chipRows).toEqual([
      expect.objectContaining({ key: 'scroll-row', detail: '3 chips' }),
    ])
  })

  test('[P1] [7.10-RULE-022] not a chip row: pill CTAs without selection state, a single pill, square tabs', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div class="row"><a href="/a" class="pill">Preview</a><a href="/b" class="pill">Plan</a></div>
       <div class="row"><button class="pill" aria-pressed="true">Lonely</button><span>text</span></div>
       <div class="row" role="tablist">
         <button role="tab" aria-selected="true" class="btn">Saved</button>
         <button role="tab" aria-selected="false" class="btn">Ideas</button>
       </div>`
    )
    expect(result.chipRows).toEqual([])
  })

  test('[P0] [7.10-RULE-023] reaction rows inside tiles are not chip rows (P1: CC-7.15 keeps one per card)', async ({
    page,
  }) => {
    const reactions = (id: string) =>
      `<div data-testid="community-card-${id}">
         <div class="row" role="group">
           <button class="pill" aria-pressed="false">Applause</button>
           <button class="pill" aria-pressed="false">Love</button>
         </div>
       </div>`
    const result = await measure(page, reactions('1') + reactions('2') + reactions('3'))
    expect(result.chipRows).toEqual([])
  })

  // P11 (CI a45f15a1): web Community's filters are underline buttons with aria-pressed at
  // phone width, not pills; a toggle filter row counts whatever its shape, segments do not.
  const underlineRow = (id: string) =>
    `<div class="row" data-testid="${id}">
       <button style="border:0;border-bottom:2px solid #111;background:none" aria-pressed="true">Auto</button>
       <button style="border:0;background:none" aria-pressed="false">All</button>
       <button style="border:0;background:none" aria-pressed="false">Cold</button>
     </div>`

  test('[P0] [7.10-RULE-024] an underline aria-pressed filter row is a chip row; a segment tablist and a stack of toggles are not (P11)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `${underlineRow('filters')}
       <div class="row" role="tablist">
         <button role="tab" aria-selected="true" class="btn">Saved</button>
         <button role="tab" aria-selected="false" class="btn">Ideas</button>
         <button role="tab" aria-selected="false" class="btn">Plan</button>
       </div>
       <div style="display:flex;flex-direction:column" role="group">
         <button class="btn" aria-pressed="false">Alerts</button>
         <button class="btn" aria-pressed="true">Digest</button>
       </div>
       <div class="row">
         <div role="switch" aria-checked="true" tabindex="0" class="btn">Ads</div>
         <div role="checkbox" aria-checked="false" tabindex="0" class="btn">Tips</div>
       </div>`
    )
    expect(keys(result.chipRows)).toEqual(['filters'])
  })

  test('[P1] [7.10-RULE-025] two underline filter rows count as two chip rows (P11)', async ({
    page,
  }) => {
    const result = await measure(page, underlineRow('row-a') + underlineRow('row-b'))
    expect(keys(result.chipRows)).toEqual(['row-a', 'row-b'])
  })

  // Codex #7: a wrapping group is judged per visual line, not only on its first chip's line.
  test('[P1] [7.10-RULE-026] a wrapping group: one wide chip on line one and two toggles on line two is one row', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div class="row" data-testid="wrap" style="flex-wrap:wrap;width:390px">
         <button class="pill" aria-pressed="true" style="width:380px">Your climate: Temperate and dry</button>
         <button class="pill" aria-pressed="false">All</button>
         <button class="pill" aria-pressed="false">Cold</button>
       </div>`
    )
    expect(result.chipRows).toHaveLength(1)
  })

  test('[P1] [7.10-RULE-027] a wrapping group with two chips on each of two lines is two rows', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div class="row" data-testid="wrap" style="flex-wrap:wrap;width:390px">
         <button class="pill" aria-pressed="true" style="width:180px">One</button>
         <button class="pill" aria-pressed="false" style="width:180px">Two</button>
         <button class="pill" aria-pressed="false" style="width:180px">Three</button>
         <button class="pill" aria-pressed="false" style="width:180px">Four</button>
       </div>`
    )
    expect(result.chipRows).toHaveLength(2)
  })

  test('[P0] [7.10-RULE-030] a card inside a card is reported; sibling cards pass; a card-coloured control is not a card', async ({
    page,
  }) => {
    const siblings = await measure(
      page,
      `<div class="card" data-testid="c1">One</div><div class="card" data-testid="c2">Two</div>
       <button class="card" data-testid="card-button">Button</button>`
    )
    expect(siblings.nestedCards).toEqual([])
    expect(siblings.stats.cards).toBe(2)
    const nested = await measure(
      page,
      '<div class="card" data-testid="outer"><div class="muted" data-testid="inner">Inner</div></div>'
    )
    expect(nested.nestedCards).toEqual([
      expect.objectContaining({ key: 'inner', detail: 'inside outer' }),
    ])
  })

  test('[P1] [7.10-RULE-030b] a same-box, same-colour wrapper inside a card is one card (TEA review M1)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      '<div class="card" data-testid="outer" style="padding:0"><div class="card" data-testid="wrapper">Content</div></div>'
    )
    expect(result.nestedCards).toEqual([])
  })

  test('[P1] [7.10-RULE-030c] an inset panel of the same colour with the card shadow is a second level (TEA review M1)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div class="card" data-testid="outer"><div class="card" data-testid="inset" style="box-shadow:${SHADOW}">Inset</div></div>`
    )
    expect(keys(result.nestedCards)).toEqual(['inset'])
  })

  test('[P1] [7.10-RULE-031] card detection: card, cardMuted, card shadow each with a radius; under 64 x 64 or radius 0 is not a card', async ({
    page,
  }) => {
    const result = await measure(
      page,
      `<div class="card">Card</div>
       <div class="muted">Muted</div>
       <div class="shadowed">Shadowed</div>
       <div class="card" style="min-height:0;height:40px;padding:4px">Small</div>
       <div class="card" style="border-radius:0">Square</div>`
    )
    expect(result.stats.cards).toBe(3)
  })

  test('[P1] [7.10-RULE-032] a card in a card inside a tile still fails (P1)', async ({
    page,
  }) => {
    const result = await measure(
      page,
      '<div data-testid="garment-card-1"><div class="card" data-testid="tile-outer"><div class="muted" data-testid="tile-inner">x</div></div></div>'
    )
    expect(keys(result.nestedCards)).toEqual(['tile-inner'])
  })

  test('[P0] [7.10-RULE-040] a two-line paragraph reports 2, three lines report 3; inline strong and links stay in the block', async ({
    page,
  }) => {
    // 200 px wide at 16 px sans: each sentence fills one line box; the inline runs share them.
    const two = await measure(
      page,
      `<p class="w200" data-testid="p2" style="white-space:pre-line">Line one with <strong>bold</strong>
Line two with <a href="/x">a link</a></p>`
    )
    expect(two.paragraphs).toEqual([expect.objectContaining({ key: 'p2', lines: 2 })])
    const three = await measure(
      page,
      `<p class="w200" data-testid="p3" style="white-space:pre-line">One
Two
Three</p>`
    )
    expect(three.paragraphs).toEqual([expect.objectContaining({ key: 'p3', lines: 3 })])
    const one = await measure(page, '<p data-testid="p1">Short line.</p>')
    expect(one.paragraphs).toEqual([])
  })

  test('[P1] [7.10-RULE-041] headings, buttons, control labels and tile captions are not paragraphs; line-clamp 2 counts 2', async ({
    page,
  }) => {
    const long =
      'A long sentence that wraps across several lines in a narrow column of text.'
    const result = await measure(
      page,
      `<h2 class="w200">${long}</h2>
       <button class="w200" style="height:auto">${long}</button>
       <label class="w200" style="display:block" for="f">${long}</label><input id="f">
       <div data-testid="community-card-1"><p class="w200">${long}</p></div>
       <p class="w200" data-testid="clamped" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">${long} ${long}</p>`
    )
    expect(result.paragraphs).toEqual([
      expect.objectContaining({ key: 'clamped', lines: 2 }),
    ])
  })

  test('[P2] [7.10-RULE-042] lines are counted after web fonts load', async ({
    page,
  }) => {
    // A font that never finishes loading would hang fonts.ready; this one is a data URI that
    // fails fast, so the measure must still return.
    const result = await measure(
      page,
      '<p style="font-family:BudgetFont" data-testid="f">x</p>',
      {
        css: '@font-face { font-family: BudgetFont; src: url(data:font/woff2;base64,AAAA); }',
      }
    )
    expect(result.paragraphs).toEqual([])
  })

  test('[P0] [7.10-RULE-050] Today height reads the document scroll height or a named element', async ({
    page,
  }) => {
    const doc = await measure(page, '<div style="height:1688px"></div>', {
      config: { todayHeight: { selector: null } },
    })
    expect(doc.todayHeight).toBe(1688)
    const over = await measure(page, '<div style="height:1689px"></div>', {
      config: { todayHeight: { selector: null } },
    })
    expect(over.todayHeight).toBe(1689)
    const scroller = await measure(
      page,
      '<div data-testid="scroll" style="height:844px;overflow-y:auto"><div style="height:3000px"></div></div>',
      { config: { todayHeight: { selector: '[data-testid="scroll"]' } } }
    )
    expect(scroller.todayHeight).toBe(3000)
  })

  test('[P0] [7.10-RULE-051] Closet chrome: grid top 160 and 161, the empty Add block the same, neither present is an error', async ({
    page,
  }) => {
    const anchors = ['[data-testid="grid"]', '[data-testid="empty-add"]']
    const at = async (top: number, id: string) =>
      measure(
        page,
        `<div style="height:${top}px"></div><div data-testid="${id}">x</div>`,
        {
          config: { closetChrome: { anchors } },
        }
      )
    expect((await at(160, 'grid')).closetChrome).toBe(160)
    expect((await at(161, 'grid')).closetChrome).toBe(161)
    expect((await at(120, 'empty-add')).closetChrome).toBe(120)
    await page.setContent(PAGE('<div>nothing</div>'))
    const missing = await page.evaluate(measureScreenBudget, {
      ...CONFIG,
      closetChrome: { anchors },
    })
    expect(missing.closetChrome).toBeUndefined()
    expect(missing.errors.join('\n')).toContain('closet anchor missing')
  })

  test('[P2] [7.10-RULE-052] the measure restores the scroll position it found', async ({
    page,
  }) => {
    await page.setContent(PAGE('<div style="height:3000px"></div>'))
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.evaluate(measureScreenBudget, CONFIG)
    expect(await page.evaluate(() => window.scrollY)).toBe(500)
  })
})

// 7.10-RULE-060..066: the analytics-only probe (D4, P6) on inline pages served from a synthetic
// origin, so same-origin analytics (/ingest) and API paths resolve as they do in the app. The
// route stubs a page that is not the app, so it is not application traffic.
const ORIGIN = 'https://budget.test'
const SYNTHETIC_TAB_BAR = ['[data-testid="tab-bar"]']

async function probeHtml(page: Page, body: string) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/' || pathname === '/next')
      return route.fulfill({ contentType: 'text/html', body: PAGE(body) })
    if (pathname.startsWith('/ingest/')) return route.fulfill({ json: { status: 1 } })
    if (pathname === '/file.txt')
      return route.fulfill({
        body: 'x',
        headers: { 'content-disposition': 'attachment; filename="file.txt"' },
      })
    return route.fulfill({ json: { ok: true } })
  })
  const open = async () => {
    await page.goto(`${ORIGIN}/`)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
  }
  const { results } = await probeScreen(page, open, SYNTHETIC_TAB_BAR)
  return results
}

const byKey = (results: readonly ProbeResult[], key: string) => {
  const result = results.find((candidate) => candidate.target.key === key)
  expect(result, `probe result for ${key}`).toBeDefined()
  return result!
}

const CAPTURE = "fetch('/ingest/e/', { method: 'POST', body: '{}' })"

test.describe('CC-7.10 analytics-only probe rules @local-lane', () => {
  test.use({ authSessionEnabled: false, viewport: { width: 390, height: 844 } })

  test('[P0] [7.10-RULE-060] a link whose handler only posts to /ingest is analytics-only; the tab bar is not probed', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<a href="#" data-testid="capture-only" onclick="event.preventDefault(); ${CAPTURE}">Preview outfits</a>
       <nav data-testid="tab-bar"><a href="/next">Closet</a></nav>`
    )
    expect(results.map((result) => result.target.key)).toEqual(['capture-only'])
    expect(analyticsOnly(results)).toEqual([{ key: 'capture-only' }])
  })

  test('[P0] [7.10-RULE-061] hash links: # and a missing anchor are analytics-only, an anchor that scrolls is an effect', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<a href="#" data-testid="bare-hash" onclick="${CAPTURE}">See the planner</a>
       <a href="#missing" data-testid="missing-hash">Missing</a>
       <a href="#present" data-testid="present-hash">Present</a>
       <div style="height:3000px"></div><div id="present">Here</div>`
    )
    expect(byKey(results, 'bare-hash').effects).toEqual([])
    expect(byKey(results, 'missing-hash').effects).toEqual([])
    expect(byKey(results, 'present-hash').effects).toContain('scroll')
  })

  test('[P0] [7.10-RULE-062] effects: navigation, an API request, a dialog, focus, a popup, a download, a DOM change', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<button data-testid="push" onclick="history.pushState({}, '', '/next?tab=1')">Push</button>
       <button data-testid="api" onclick="fetch('/api/v1/wardrobe/saved-looks', { method: 'POST', body: '{}' })">Api</button>
       <button data-testid="alert" onclick="window.confirm('Sure?')">Confirm</button>
       <button data-testid="focus" onclick="document.getElementById('field').focus()">Focus</button>
       <a data-testid="popup" href="${ORIGIN}/next" target="_blank">Popup</a>
       <a data-testid="download" href="/file.txt" download>Download</a>
       <button data-testid="sheet" onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog>Sheet</div>')">Sheet</button>
       <input id="field" data-testid="field" aria-label="Field">`
    )
    expect(byKey(results, 'push').effects).toContain('navigation /next?tab=1')
    expect(byKey(results, 'api').effects).toContain(
      'request POST /api/v1/wardrobe/saved-looks'
    )
    expect(byKey(results, 'alert').effects).toContain('dialog confirm')
    expect(byKey(results, 'focus').effects).toContain('focus input')
    expect(byKey(results, 'popup').effects).toContain('popup')
    expect(byKey(results, 'download').effects).toContain('download')
    expect(byKey(results, 'sheet').effects.join(' ')).toMatch(/dom \d+ change/)
    expect(analyticsOnly(results)).toEqual([])
    expect(probeErrors(results)).toEqual([])
    // Text entry is typed into, not clicked: the field is not probed.
    expect(results.map((result) => result.target.key)).not.toContain('field')
  })

  test('[P0] [7.10-RULE-063] file chooser: opening it is no effect; an analytics-only change handler is analytics-only, a preview is an effect', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<label for="upload" data-testid="track-upload">Start wardrobe upload</label>
       <input id="upload" type="file" class="sr-only" onchange="${CAPTURE}; this.value = ''">
       <label for="preview" data-testid="preview-upload">Add a photo</label>
       <input id="preview" type="file" class="sr-only"
              onchange="document.getElementById('out').textContent = this.files[0].name">
       <p id="out"></p>`
    )
    expect(byKey(results, 'track-upload').effects).toEqual([])
    expect(byKey(results, 'preview-upload').effects.join(' ')).toMatch(/dom \d+ change/)
  })

  test('[P1] [7.10-RULE-064] background churn without a click is not an effect', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<span id="clock">0</span>
       <script>let n = 0; setInterval(() => { document.getElementById('clock').textContent = String(++n) }, 100)</script>
       <button data-testid="quiet" onclick="${CAPTURE}">Quiet</button>`
    )
    expect(byKey(results, 'quiet').effects).toEqual([])
  })

  test('[P1] [7.10-RULE-065] a change inside the control only is not an effect', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<button data-testid="self" aria-pressed="false"
               onclick="this.setAttribute('aria-pressed', 'true'); this.textContent = 'Pressed'; ${CAPTURE}">Press</button>`
    )
    expect(byKey(results, 'self').effects).toEqual([])
  })

  test('[P1] [7.10-RULE-067] an option that is already selected is not probed; its unselected twins keep their positions', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<div role="group">
         <button data-testid="chip" aria-pressed="true" onclick="${CAPTURE}">Personal</button>
         <button data-testid="chip" aria-pressed="false" onclick="document.getElementById('out').textContent = 'community'">Community</button>
       </div>
       <a href="/next" aria-current="page" data-testid="current">Here</a>
       <p id="out"></p>`
    )
    expect(results.map((result) => result.target.key)).toEqual(['chip #2'])
    expect(byKey(results, 'chip #2').effects.join(' ')).toMatch(/dom \d+ change/)
    expect(probeErrors(results)).toEqual([])
  })

  test('[P1] [7.10-RULE-068] a panel inserted under a parent that changes on its own is still an effect', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<div id="group">
         <button data-testid="expander" aria-expanded="false"
                 onclick="this.setAttribute('aria-expanded', 'true'); this.insertAdjacentHTML('afterend', '<div>Panel</div>')">More</button>
       </div>
       <script>let t = 0; setInterval(() => document.getElementById('group').setAttribute('data-tick', String(++t)), 100)</script>`
    )
    expect(byKey(results, 'expander').effects.join(' ')).toMatch(/dom \d+ change/)
  })

  test('[P0] [7.10-RULE-069] a control below the fold that only captures is analytics-only; the probe scrolls it into view first (Codex #1)', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<div style="height:2400px"></div>
       <button data-testid="deep-capture" onclick="${CAPTURE}">Preview outfits</button>`
    )
    expect(byKey(results, 'deep-capture').effects).toEqual([])
    expect(analyticsOnly(results)).toEqual([{ key: 'deep-capture' }])
  })

  test('[P0] [7.10-RULE-070] toggles that can be turned off are probed: an on switch, a checked checkbox and a lone pressed button whose off path only captures (Codex #5)', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<div role="switch" tabindex="0" aria-checked="true" data-testid="switch" onclick="${CAPTURE}">Tips</div>
       <div role="checkbox" tabindex="0" aria-checked="true" data-testid="checkbox" onclick="${CAPTURE}">Daily</div>
       <section><button aria-pressed="true" data-testid="lone-toggle" onclick="${CAPTURE}">Follow</button></section>
       <div role="radiogroup">
         <div role="radio" tabindex="0" aria-checked="true" data-testid="radio-on">Cold</div>
         <div role="radio" tabindex="0" aria-checked="false" data-testid="radio-off"
              onclick="document.getElementById('out').textContent = 'warm'">Warm</div>
       </div>
       <p id="out"></p>`
    )
    expect(
      analyticsOnly(results)
        .map((element) => element.key)
        .sort()
    ).toEqual(['checkbox', 'lone-toggle', 'switch'])
    // The checked radio is the current choice of an exclusive set: not probed.
    expect(results.map((result) => result.target.key)).not.toContain('radio-on')
    expect(byKey(results, 'radio-off').effects.join(' ')).toMatch(/dom \d+ change/)
  })

  test('[P1] [7.10-RULE-071] a fresh load resolves the target by the rules that listed it: a hidden copy and a same-name control of another role cannot stand in (Codex #6)', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<button data-testid="twin" style="display:none" onclick="location.href='/next'">Hidden copy</button>
       <button data-testid="twin" onclick="${CAPTURE}">Visible copy</button>
       <a href="/next" role="tab">Share</a>
       <span role="button" tabindex="0" onclick="${CAPTURE}">Share</span>`
    )
    expect(byKey(results, 'twin').effects).toEqual([])
    expect(probeErrors(results)).toEqual([])
    const share = results.filter((result) => result.target.name === 'Share')
    expect(share.map((result) => result.target.role).sort()).toEqual(['button', 'tab'])
    expect(share.find((result) => result.target.role === 'button')?.effects).toEqual([])
    expect(
      share.find((result) => result.target.role === 'tab')?.effects.join(' ')
    ).toMatch(/navigation \/next/)
  })

  test('[P0] [7.10-RULE-072] a read alone is no effect; a bare # link below the fold that jumps to the top is analytics-only (CI 61701d25)', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<button data-testid="read-only" onclick="fetch('/api/v1/community/events'); ${CAPTURE}">Refresh</button>
       <button data-testid="read-shown"
               onclick="fetch('/api/v1/ritual').then(() => { document.getElementById('out').textContent = 'loaded' })">Load</button>
       <p id="out"></p>
       <div style="height:2400px"></div>
       <a href="#" data-testid="deep-hash" onclick="${CAPTURE}">Preview outfits</a>`
    )
    expect(byKey(results, 'read-only').effects).toEqual([])
    expect(byKey(results, 'read-shown').effects.join(' ')).toMatch(/dom \d+ change/)
    expect(byKey(results, 'deep-hash').effects).toEqual([])
  })

  test('[P1] [7.10-RULE-066] a target that is not found in its fresh load is a probe error, never a silent skip', async ({
    page,
  }) => {
    const results = await probeHtml(
      page,
      `<div id="slot"></div>
       <script>
         if (!sessionStorage.getItem('seen')) {
           sessionStorage.setItem('seen', '1')
           document.getElementById('slot').innerHTML = '<button data-testid="once">Once</button>'
         }
       </script>`
    )
    expect(probeErrors(results)).toEqual([
      'probe once: not found in a fresh load (0 matches)',
    ])
    expect(analyticsOnly(results)).toEqual([])
  })
})
