// Story CC-7.9 test owner (TEA): self-checks of the painted-contrast probe on inline pages, so a
// probe rule is proven on the shape that broke it before it runs on product screens.
import { expect, test } from '../support/fixtures/merged-fixtures'
import { textContrastFailures } from '../support/helpers/painted-contrast'

const PAGE = (body: string) => `<!doctype html>
<html><head><style>
  body { margin: 0; font: 16px/1.4 sans-serif; background: #ffffff; color: #111111; }
  section { position: relative; padding: 24px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
  .inset { position: absolute; clip-path: inset(50%); }
  .cover { position: absolute; inset: 24px 0 auto 0; height: 40px; background: #ffffff; }
</style></head><body>${body}</body></html>`

test.describe('painted-contrast probe @local-lane', () => {
  test.use({ authSessionEnabled: false })

  // CI e5d4cfa5: the community live region (an sr-only div) holds a span that keeps its own
  // 428 x 19 box over the visible eyebrow; the scan measured it and refused it as covered.
  test('[P1] [7.9-PROBE-001] text clipped away by an sr-only parent is skipped, the visible text is measured', async ({
    page,
  }) => {
    await page.setContent(
      PAGE(`<section data-testid="probe-root">
        <div class="sr-only" aria-live="polite"><span>Showing your climate looks. 2 loaded.</span></div>
        <div class="inset"><span>Also hidden by clip-path inset 50 percent.</span></div>
        <span>City Spotlight</span>
        <p>Standout looks near you from the past week.</p>
      </section>`)
    )
    await expect(textContrastFailures(page.getByTestId('probe-root'))).resolves.toEqual(
      []
    )
  })

  test('[P1] [7.9-PROBE-002] text painted over by an opaque layer is still refused as covered', async ({
    page,
  }) => {
    await page.setContent(
      PAGE(`<section data-testid="probe-root">
        <span>City Spotlight</span>
        <div class="cover"></div>
      </section>`)
    )
    await expect(textContrastFailures(page.getByTestId('probe-root'))).rejects.toThrow(
      /covered by div/
    )
  })
})
