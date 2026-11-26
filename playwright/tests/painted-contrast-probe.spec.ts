// Story CC-7.9 test owner (TEA): self-checks of the painted-contrast probe on inline pages, so a
// probe rule is proven on the shape that broke it before it runs on product screens. Each skip
// branch is exercised alone, next to visible low-contrast text that must still fail (Codex
// check 3), and the focus ring rule has negative controls.
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { focusRing, textContrastFailures } from '../support/helpers/painted-contrast'

const PAGE = (body: string, css = '') => `<!doctype html>
<html><head><style>
  body { margin: 0; font: 16px/1.4 sans-serif; background: #ffffff; color: #111111; }
  section { position: relative; padding: 24px; }
  .faint { color: #c8c8c8; }
  ${css}
</style></head><body>${body}</body></html>`

const VISIBLE = '<span>City Spotlight</span><p class="faint">Faint visible line.</p>'
const root = (page: Page) => page.getByTestId('probe-root')
const failingTexts = async (page: Page) =>
  (await textContrastFailures(root(page))).map((failure) => failure.text)

test.describe('painted-contrast probe @local-lane', () => {
  test.use({ authSessionEnabled: false })

  // CI e5d4cfa5: the community live region (an sr-only div) holds a span that keeps its own
  // 428 x 19 box over the visible eyebrow; the scan measured it and refused it as covered.
  for (const [id, label, hidden] of [
    [
      '7.9-PROBE-001a',
      'clip rect(0 0 0 0) on an absolutely positioned parent',
      '<div style="position:absolute;width:10px;height:10px;overflow:visible;clip:rect(0,0,0,0);white-space:nowrap"><span>Hidden by clip on a positioned box.</span></div>',
    ],
    [
      '7.9-PROBE-001b',
      'clip-path inset(50%) on the parent',
      '<div style="position:absolute;clip-path:inset(50%);white-space:nowrap"><span>Hidden by clip-path inset.</span></div>',
    ],
    [
      '7.9-PROBE-001c',
      'a 1 x 1 px parent that clips both axes',
      '<div style="position:absolute;width:1px;height:1px;overflow:hidden;white-space:nowrap"><span>Hidden in a one pixel box.</span></div>',
    ],
  ] as const) {
    test(`[P1] [${id}] text hidden by ${label} is skipped; the faint visible line still fails`, async ({
      page,
    }) => {
      await page.setContent(
        PAGE(`<section data-testid="probe-root">${hidden}${VISIBLE}</section>`)
      )
      expect(await failingTexts(page)).toEqual(['Faint visible line.'])
    })
  }

  test('[P1] [7.9-PROBE-001d] clip on a box that is not positioned clips nothing, so its faint text is measured', async ({
    page,
  }) => {
    await page.setContent(
      PAGE(
        '<section data-testid="probe-root"><div style="clip:rect(0,0,0,0)"><span class="faint">Clip ignored here.</span></div><span>City Spotlight</span></section>'
      )
    )
    expect(await failingTexts(page)).toEqual(['Clip ignored here.'])
  })

  // Codex check 4: a positioned child escapes the overflow of a wrapper below its containing
  // block, so a 1 px wrapper hides nothing of it.
  test('[P1] [7.9-PROBE-001f] an absolutely positioned child escapes a 1 px wrapper below its containing block and is measured', async ({
    page,
  }) => {
    await page.setContent(
      PAGE(
        '<section data-testid="probe-root" style="height:120px"><div style="width:1px;height:1px;overflow:hidden"><span class="faint" style="position:absolute;left:24px;top:60px;white-space:nowrap">Escapes the wrapper.</span></div><span>City Spotlight</span></section>'
      )
    )
    expect(await failingTexts(page)).toEqual(['Escapes the wrapper.'])
  })

  // Codex check 4: one run over two backgrounds 1% apart, one failing by a hair; the failing one
  // decides at both floors.
  for (const [id, label, size, left, right, floor] of [
    ['7.9-PROBE-010a', 'normal text at 4.5:1', '16px', '#747474', '#757474', 4.5],
    ['7.9-PROBE-010b', 'large text at 3:1', '24px', '#595959', '#59595a', 3],
  ] as const) {
    test(`[P1] [${id}] ${label}: a background just under the floor fails beside one just over it`, async ({
      page,
    }) => {
      await page.setContent(
        PAGE(
          `<section data-testid="probe-root"><p style="font-size:${size};font-weight:700;color:#000000;background:linear-gradient(90deg, ${left} 50%, ${right} 50%);padding:8px 0;margin:0">HHHHHHHHHHHH MMMMMMMMMMMM</p></section>`
        )
      )
      const failures = await textContrastFailures(root(page))
      expect(failures.map((failure) => failure.text)).toEqual([
        'HHHHHHHHHHHH MMMMMMMMMMMM',
      ])
      expect(failures[0]!.required).toBe(floor)
      expect(failures[0]!.ratio).toBeLessThan(floor)
    })
  }

  test('[P1] [7.9-PROBE-002] text painted over by an opaque layer is still refused as covered', async ({
    page,
  }) => {
    await page.setContent(
      PAGE(
        '<section data-testid="probe-root"><span>City Spotlight</span><div class="cover"></div></section>',
        '.cover { position: absolute; inset: 24px 0 auto 0; height: 40px; background: #ffffff; }'
      )
    )
    await expect(textContrastFailures(root(page))).rejects.toThrow(/covered by div/)
  })

  const BUTTON_CSS = `
    button { margin: 40px; width: 96px; height: 40px; border: 1px solid #111111;
      border-radius: 8px; background: #ffffff; color: #111111; font: 16px sans-serif; }
    button:focus { outline: none; }`
  const ring = async (page: Page, css: string, extra = '') => {
    await page.setContent(
      PAGE(`<button type="button">Applaud</button>${extra}`, BUTTON_CSS + css)
    )
    const button = page.getByRole('button', { name: 'Applaud' })
    // A keyboard Tab first, so a later programmatic focus matches :focus-visible.
    await page.keyboard.press('Tab')
    return focusRing(button, async () => {
      await button.focus()
      await expect(button).toBeFocused()
    })
  }

  test('[P1] [7.9-PROBE-003] a 2 px outline at offset 2 covers the WCAG 2.4.13 area at 3:1', async ({
    page,
  }) => {
    const result = await ring(
      page,
      'button:focus-visible { outline: 2px solid #111111; outline-offset: 2px; }'
    )
    expect(result!.qualifying).toBeGreaterThanOrEqual(result!.required!)
  })

  test('[P1] [7.9-PROBE-004] focus that paints no ring falls short of the area', async ({
    page,
  }) => {
    const result = await ring(page, '')
    expect(result!.qualifying).toBeLessThan(result!.required!)
  })

  test('[P1] [7.9-PROBE-005] focus that moves the control is refused before scoring', async ({
    page,
  }) => {
    await expect(
      ring(page, 'button:focus-visible { transform: translateX(6px); }')
    ).rejects.toThrow(/moved between the shots/)
  })

  test('[P1] [7.9-PROBE-006] a faint ring that changes pixels below 3:1 falls short of the area', async ({
    page,
  }) => {
    const result = await ring(
      page,
      'button:focus-visible { outline: 2px solid #e6e6e6; outline-offset: 2px; }'
    )
    expect(result!.painted).toBeGreaterThan(0)
    expect(result!.qualifying).toBeLessThan(result!.required!)
  })

  // CI 48c7a01e: a white band over the top half of the applause pill left the ring only on the
  // bottom half; it read as a short ring, not as the cover it is.
  test('[P1] [7.9-PROBE-007] a layer over the top half of the control is refused as a cover', async ({
    page,
  }) => {
    await expect(
      ring(
        page,
        `button:focus-visible { outline: 2px solid #111111; outline-offset: 2px; }
        .band { position: absolute; left: 0; right: 0; top: 30px; height: 26px; background: #ffffff; }`,
        '<div class="band"></div>'
      )
    ).rejects.toThrow(/covered by div/)
  })

  // Codex check 4: a strip inside the clip margin that repaints when the button takes focus
  // changes 640 samples at 21:1, more than the button's 517, while the button shows no ring.
  test('[P1] [7.9-PROBE-008] paint elsewhere that changes on focus is not the control ring', async ({
    page,
  }) => {
    const result = await ring(
      page,
      `.strip { position: absolute; left: 48px; top: 32px; width: 80px; height: 8px; background: #ffffff; }
      body:has(button:focus-visible) .strip { background: #000000; }`,
      '<div class="strip"></div>'
    )
    expect(result!.qualifying).toBeLessThan(result!.required!)
  })

  // Codex check 4: a blur that moves the control leaves the exclusion where the bare shot sees
  // it; focus repainting the control's own fill is no ring either.
  test('[P1] [7.9-PROBE-009] a control moved on blur that only repaints its own fill falls short', async ({
    page,
  }) => {
    const result = await ring(
      page,
      `button.moved { transform: translateX(9px); }
      button:focus-visible { background: #000000; color: #ffffff; }`,
      "<script>document.querySelector('button').addEventListener('blur', (event) => event.target.classList.add('moved'))</script>"
    )
    expect(result!.qualifying).toBeLessThan(result!.required!)
  })
})
