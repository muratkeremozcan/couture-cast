import type { Page, Request, Response, TestInfo } from '@playwright/test'

/**
 * Where a failed page.goto stopped, in milliseconds after the call: when the main-frame
 * navigation request started, when its response headers arrived (first byte), and when
 * DOMContentLoaded and load fired. A null field is a milestone the navigation never
 * reached. `browser` is the browser's own resource timing for that request.
 */
export type GotoTiming = {
  url: string
  timeoutMs: number | null
  failedAtMs: number
  requestStartMs: number | null
  firstByteMs: number | null
  responseStatus: number | null
  domContentLoadedMs: number | null
  loadMs: number | null
  browser: ReturnType<Request['timing']> | null
  error: string
}

type GotoPage = Pick<Page, 'goto' | 'on' | 'off' | 'mainFrame'>
const wrapped = new WeakSet<object>()

/** Makes every failed page.goto on `page` attach its timing to the test result. */
export function attachGotoTimingOnFailure(
  page: GotoPage,
  info: Pick<TestInfo, 'attach'>,
  now: () => number = () => performance.now()
) {
  if (wrapped.has(page)) return
  wrapped.add(page)
  const goto = page.goto.bind(page)
  page.goto = async (url, options) => {
    const started = now()
    const elapsed = () => Math.round(now() - started)
    let navigation: Request | undefined
    const timing = {
      requestStartMs: null as number | null,
      firstByteMs: null as number | null,
      responseStatus: null as number | null,
      domContentLoadedMs: null as number | null,
      loadMs: null as number | null,
    }
    const onRequest = (request: Request) => {
      if (navigation || !request.isNavigationRequest()) return
      if (request.frame() !== page.mainFrame()) return
      navigation = request
      timing.requestStartMs = elapsed()
    }
    const onResponse = (response: Response) => {
      if (!navigation || response.request() !== navigation) return
      timing.firstByteMs ??= elapsed()
      timing.responseStatus ??= response.status()
    }
    const onDomContentLoaded = () => {
      timing.domContentLoadedMs ??= elapsed()
    }
    const onLoad = () => {
      timing.loadMs ??= elapsed()
    }
    page.on('request', onRequest)
    page.on('response', onResponse)
    page.on('domcontentloaded', onDomContentLoaded)
    page.on('load', onLoad)
    try {
      return await goto(url, options)
    } catch (error) {
      const value: GotoTiming = {
        url,
        timeoutMs: options?.timeout ?? null,
        failedAtMs: elapsed(),
        ...timing,
        browser: navigation ? navigation.timing() : null,
        error: (error instanceof Error ? error.message : String(error)).split('\n')[0]!,
      }
      await info.attach('page-goto-timing', {
        body: JSON.stringify(value, null, 2),
        contentType: 'application/json',
      })
      throw error
    } finally {
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('domcontentloaded', onDomContentLoaded)
      page.off('load', onLoad)
    }
  }
}
