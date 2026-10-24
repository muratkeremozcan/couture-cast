// Story 6.7b R1: a stand-in for the partner tab `beginAffiliatePartnerHandoff`
// claims with `window.open('about:blank', '_blank')`. The tab owns a real jsdom
// document, so the handoff's `<a rel="noreferrer">` is built and activated there,
// and each activation is recorded as a navigation instead of reaching jsdom.
import { onTestFinished, vi } from 'vitest'

export interface PartnerTabStub {
  openSpy: ReturnType<typeof vi.fn>
  tab: { opener: unknown; document: Document; close: ReturnType<typeof vi.fn> }
  navigations: { href: string; rel: string }[]
}

export function stubPartnerTab(options: { blocked?: boolean } = {}): PartnerTabStub {
  const tabDocument = document.implementation.createHTMLDocument('')
  const navigations: PartnerTabStub['navigations'] = []
  // A non-null opener until the handoff severs it, as a freshly opened tab has.
  const tab = { opener: window as unknown, document: tabDocument, close: vi.fn() }
  const click = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'click')!
    .value as (this: HTMLElement) => void
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    if (this.ownerDocument === tabDocument) {
      navigations.push({ href: this.href, rel: this.rel })
      return
    }
    click.call(this)
  })
  const openSpy = vi.fn(() => (options.blocked ? null : tab))
  const original = window.open
  window.open = openSpy as unknown as typeof window.open
  onTestFinished(() => {
    window.open = original
  })
  return { openSpy, tab, navigations }
}
