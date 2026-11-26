// Learning path Step 66: One app shell and visual system (coordinator add-on to PR 7.9).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-UNIT-101..112, the preview API proxy from ea7c7936.
//
// A preview web deployment reaches its protected preview API through a same-origin route that
// adds the Vercel protection bypass on the server. These cases hold the three promises that make
// that safe: production and local builds keep the direct rewrite, the route is a 404 anywhere the
// proxy is not configured, and the secret never leaves the server (not in a log, not in a
// response) while nothing the browser sends can reach outside /api/v1 or carry its own bypass.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_API_PROXY_ROUTE,
  PROTECTION_BYPASS_HEADER,
  previewApiProxyConfig,
  proxyPreviewApi,
  type PreviewApiProxyConfig,
} from './preview-api-proxy'

const SECRET = 'tea-bypass-secret-7-9-not-real'
const API = 'https://couture-api-git-feature.vercel.app'
const CONFIG: PreviewApiProxyConfig = { baseUrl: API, bypassSecret: SECRET }

const previewEnv = (overrides: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview',
  PREVIEW_API_PROTECTION_BYPASS_SECRET: SECRET,
  VERCEL_API_BASE_URL: API,
  ...overrides,
})

/** A fetch double that records the one upstream request and answers `response`. */
function upstream(response: Response = new Response('{}', { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      init: init ?? {},
    })
    return Promise.resolve(response)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const browserRequest = (path: string, init: RequestInit = {}) =>
  new Request(`https://couture-web-git-feature.vercel.app/api/v1/${path}`, init)

describe('previewApiProxyConfig', () => {
  it('[P0] [7.9-UNIT-101] is on only for a preview deployment with a secret and an https API origin', () => {
    expect(previewApiProxyConfig(previewEnv())).toEqual(CONFIG)
    for (const VERCEL_ENV of ['production', 'development', undefined])
      expect(
        previewApiProxyConfig(previewEnv({ VERCEL_ENV })),
        String(VERCEL_ENV)
      ).toBeNull()
    for (const secret of [undefined, '', '   '])
      expect(
        previewApiProxyConfig(
          previewEnv({ PREVIEW_API_PROTECTION_BYPASS_SECRET: secret })
        )
      ).toBeNull()
  })

  it('[P1] [7.9-UNIT-102] refuses an API base that is not a bare https origin', () => {
    for (const base of [
      'http://couture-api.vercel.app',
      'https://couture-api.vercel.app/api',
      'https://couture-api.vercel.app/?x=1',
      // Codex P3-2: a fragment would swallow the appended path; credentials make fetch throw.
      'https://couture-api.vercel.app/#x',
      'https://couture-api.vercel.app#',
      'https://user:pass@couture-api.vercel.app',
      'https://user@couture-api.vercel.app',
      'not a url',
      '',
    ])
      expect(
        previewApiProxyConfig(previewEnv({ VERCEL_API_BASE_URL: base })),
        base
      ).toBeNull()
  })

  it('[P1] [7.9-UNIT-103] reads the API base in next.config order without PROD_API_BASE_URL, trailing slash trimmed', () => {
    expect(
      previewApiProxyConfig({
        VERCEL_ENV: 'preview',
        PREVIEW_API_PROTECTION_BYPASS_SECRET: SECRET,
        PROD_API_BASE_URL: 'https://prod-api.example.test',
        VERCEL_API_BRANCH_URL: 'https://branch-api.example.test',
        API_BASE_URL: 'https://api-base.example.test/',
      })?.baseUrl
    ).toBe('https://branch-api.example.test')
    expect(
      previewApiProxyConfig({
        VERCEL_ENV: 'preview',
        PREVIEW_API_PROTECTION_BYPASS_SECRET: SECRET,
        PROD_API_BASE_URL: 'https://prod-api.example.test',
      })
    ).toBeNull()
  })
})

describe('proxyPreviewApi', () => {
  afterEach(() => vi.restoreAllMocks())

  it('[P0] [7.9-UNIT-104] answers 404 without calling anything when the proxy is not configured', async () => {
    const { fetchImpl } = upstream()
    const response = await proxyPreviewApi(
      browserRequest('ritual'),
      ['ritual'],
      null,
      fetchImpl
    )
    expect(response.status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('[P0] [7.9-UNIT-105] forwards method, path, query and body to /api/v1 with the bypass added', async () => {
    const { fetchImpl, calls } = upstream(new Response('{"ok":true}', { status: 201 }))
    const response = await proxyPreviewApi(
      browserRequest('wardrobe/garments?limit=24', {
        method: 'POST',
        body: '{"name":"coat"}',
        headers: { 'content-type': 'application/json', authorization: 'Bearer member' },
      }),
      ['wardrobe', 'garments'],
      CONFIG,
      fetchImpl
    )
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('{"ok":true}')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${API}/api/v1/wardrobe/garments?limit=24`)
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.redirect).toBe('manual')
    const sent = new Headers(calls[0]!.init.headers)
    expect(sent.get(PROTECTION_BYPASS_HEADER)).toBe(SECRET)
    expect(sent.get('authorization')).toBe('Bearer member')
    expect(sent.get('content-type')).toBe('application/json')
    expect(await new Response(calls[0]!.init.body).text()).toBe('{"name":"coat"}')
  })

  it('[P0] [7.9-UNIT-106] a browser cannot send its own bypass or other x-vercel-* headers, nor Vercel cookies', async () => {
    const { fetchImpl, calls } = upstream()
    await proxyPreviewApi(
      browserRequest('ritual', {
        headers: {
          [PROTECTION_BYPASS_HEADER]: 'browser-guess',
          'x-vercel-set-bypass-cookie': 'true',
          'x-vercel-forwarded-for': '203.0.113.9',
          cookie: '_vercel_jwt=web-share; sb-access=member; _vercel_sso_nonce=n',
          host: 'couture-web-git-feature.vercel.app',
        },
      }),
      ['ritual'],
      CONFIG,
      fetchImpl
    )
    const sent = new Headers(calls[0]!.init.headers)
    expect(sent.get(PROTECTION_BYPASS_HEADER)).toBe(SECRET)
    expect([...sent.keys()].filter((name) => name.startsWith('x-vercel-'))).toEqual([
      PROTECTION_BYPASS_HEADER,
    ])
    expect(sent.get('cookie')).toBe('sb-access=member')
    expect(sent.get('host')).toBeNull()
  })

  it('[P0] [7.9-UNIT-107] no path segment reaches outside /api/v1 on the API host', async () => {
    for (const segments of [
      ['..', 'internal'],
      ['wardrobe', '..', '..', 'admin'],
      ['%2e%2e', 'internal'],
      ['.', 'ritual'],
      ['..%2f..%2fadmin'],
    ]) {
      const { fetchImpl, calls } = upstream()
      const response = await proxyPreviewApi(
        browserRequest(segments.join('/')),
        segments,
        CONFIG,
        fetchImpl
      )
      const reached = calls.map((call) => new URL(call.url))
      // Either refused before any upstream call, or every call stays on the host under /api/v1/.
      for (const url of reached) {
        expect(url.origin, segments.join('/')).toBe(API)
        expect(
          url.pathname.startsWith('/api/v1/'),
          `${segments.join('/')} -> ${url.pathname}`
        ).toBe(true)
      }
      if (reached.length === 0) expect(response.status, segments.join('/')).toBe(404)
    }
  })

  it('[P0] [7.9-UNIT-113] reserved deployment-protection query options never reach the API (Codex P2-1)', async () => {
    const { fetchImpl, calls } = upstream()
    await proxyPreviewApi(
      browserRequest(
        'ritual?x-vercel-protection-bypass=guess&x-vercel-set-bypass-cookie=samesitenone&X-Vercel-Set-Bypass-Cookie=true&limit=24&city=Chicago'
      ),
      ['ritual'],
      CONFIG,
      fetchImpl
    )
    const sent = new URL(calls[0]!.url)
    expect(sent.origin + sent.pathname).toBe(`${API}/api/v1/ritual`)
    expect([...sent.searchParams.keys()]).toEqual(['limit', 'city'])
    expect(sent.searchParams.get('limit')).toBe('24')
    expect(new Headers(calls[0]!.init.headers).get(PROTECTION_BYPASS_HEADER)).toBe(SECRET)
  })

  it('[P0] [7.9-UNIT-108] the secret never comes back to the browser and never reaches a log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = vi.fn(() =>
      Promise.reject(new Error(`connect ECONNREFUSED with ${SECRET} in the message`))
    ) as unknown as typeof fetch

    const response = await proxyPreviewApi(
      browserRequest('ritual'),
      ['ritual'],
      CONFIG,
      failing
    )
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain(SECRET)
    expect([...response.headers.values()].join(' ')).not.toContain(SECRET)
    const logged = JSON.stringify([error.mock.calls, log.mock.calls, warn.mock.calls])
    expect(logged).not.toContain(SECRET)
    expect(error).toHaveBeenCalledTimes(1)

    // An upstream that echoes the bypass header back does not hand it to the browser either.
    const echo = new Response('{}', { headers: { [PROTECTION_BYPASS_HEADER]: SECRET } })
    const echoed = await proxyPreviewApi(
      browserRequest('ritual'),
      ['ritual'],
      CONFIG,
      upstream(echo).fetchImpl
    )
    expect([...echoed.headers.values()].join(' ')).not.toContain(SECRET)
  })

  it('[P1] [7.9-UNIT-109] response hop-by-hop headers and every Set-Cookie drop, HEAD has no body', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      connection: 'keep-alive',
      'content-encoding': 'gzip',
      'cache-control': 'no-store',
    })
    // The API sets no cookie the web reads, and Vercel's own (a protection bypass cookie
    // included) would grant direct access to the protected API: none reaches the browser
    // (Codex P2-1).
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', '_vercel_jwt=bypass-grant; Path=/; HttpOnly')
    const { fetchImpl } = upstream(new Response('{"x":1}', { status: 200, headers }))
    const response = await proxyPreviewApi(
      browserRequest('ritual'),
      ['ritual'],
      CONFIG,
      fetchImpl
    )
    expect(response.headers.get('connection')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('set-cookie')).toBeNull()

    const head = await proxyPreviewApi(
      browserRequest('ritual', { method: 'HEAD' }),
      ['ritual'],
      CONFIG,
      upstream(new Response(null, { status: 200 })).fetchImpl
    )
    expect(head.body).toBeNull()
  })

  it('[P1] [7.9-UNIT-110] a redirect from the API passes through unfollowed; a browser that left gets 499', async () => {
    const { fetchImpl } = upstream(
      new Response(null, { status: 307, headers: { location: `${API}/api/v1/next` } })
    )
    const redirect = await proxyPreviewApi(
      browserRequest('ritual'),
      ['ritual'],
      CONFIG,
      fetchImpl
    )
    expect(redirect.status).toBe(307)
    expect(redirect.headers.get('location')).toBe(`${API}/api/v1/next`)

    const controller = new AbortController()
    controller.abort()
    const aborted = await proxyPreviewApi(
      browserRequest('ritual', { signal: controller.signal }),
      ['ritual'],
      CONFIG,
      vi.fn(() =>
        Promise.reject(new DOMException('aborted', 'AbortError'))
      ) as unknown as typeof fetch
    )
    expect(aborted.status).toBe(499)
  })
})

describe('next.config rewrites', () => {
  const API_KEYS = [
    'PROD_API_BASE_URL',
    'VERCEL_API_BASE_URL',
    'VERCEL_API_BRANCH_URL',
    'API_BASE_URL',
    'PREVIEW_API_BASE_URL',
    'PREVIEW_API_PROTECTION_BYPASS_SECRET',
    'VERCEL_ENV',
  ]

  /** next.config.ts after a fresh import under `env`; every API key not named is blank. */
  async function rewritesUnder(env: Record<string, string>) {
    vi.resetModules()
    // Blank, not unset: next.config fills only undefined keys from the root .env files.
    for (const key of API_KEYS) vi.stubEnv(key, env[key] ?? '')
    vi.stubEnv('NODE_ENV', env.NODE_ENV ?? 'production')
    const { default: config } = await import('../../next.config')
    return config.rewrites!()
  }

  afterEach(() => vi.unstubAllEnvs())

  it('[P0] [7.9-UNIT-111] production and local builds keep the direct /api/v1 rewrite, even with a secret set', async () => {
    expect(
      await rewritesUnder({
        VERCEL_ENV: 'production',
        PROD_API_BASE_URL: 'https://api.couturecast.example',
        PREVIEW_API_PROTECTION_BYPASS_SECRET: SECRET,
        VERCEL_API_BASE_URL: API,
      })
    ).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'https://api.couturecast.example/api/v1/:path*',
      },
    ])
    expect(
      await rewritesUnder({
        NODE_ENV: 'development',
        API_BASE_URL: 'http://localhost:4000',
      })
    ).toEqual([
      { source: '/api/v1/:path*', destination: 'http://localhost:4000/api/v1/:path*' },
    ])
  })

  it('[P0] [7.9-UNIT-112] a configured preview build sends /api/v1 to the same-origin proxy route', async () => {
    const routes = await rewritesUnder({
      VERCEL_ENV: 'preview',
      PREVIEW_API_PROTECTION_BYPASS_SECRET: SECRET,
      VERCEL_API_BASE_URL: API,
    })
    expect(routes).toEqual([
      { source: '/api/v1/:path*', destination: `${PREVIEW_API_PROXY_ROUTE}/:path*` },
    ])
    expect(JSON.stringify(routes)).not.toContain(SECRET)
  })
})
