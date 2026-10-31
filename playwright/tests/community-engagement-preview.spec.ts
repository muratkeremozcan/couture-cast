// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 O1 / OPS-001..003: the realtime socket on the deployed, protected Vercel preview.
//
// The protocol claims run in `scripts/probe-community-preview.mjs` as a child process: it
// inherits the CI environment in memory, sends the deployment-protection bypass only as a
// request header, and writes redacted evidence (no bearer, no bypass value). This spec runs
// it against the preview this run targets and asserts each claim.
//
// Identities are the API's fixture bearers, which a preview deployment accepts behind
// deployment protection (VERCEL_ENV=preview). The browser half additionally needs the
// web preview to accept a signed-in session; see the skip reason below.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../support/fixtures/merged-fixtures'
import { seedWebSession } from '../support/helpers/commerce-session'
import { resolveApiBaseUrl } from '../support/helpers/api-test'

type Claim = { status: 'pass' | 'fail' | 'not-executed' | 'observed-single' } & Record<
  string,
  unknown
>
type Evidence = {
  deployment: { status: number; gitSha: string | null; environment: string | null }
  claims: Record<string, Claim>
}

const repoRoot = path.resolve(__dirname, '..', '..')
const isPreview = (metadata: Record<string, unknown>) =>
  metadata.environment === 'preview'

function runProbe(env: Record<string, string>, timeoutMs: number) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/probe-community-preview.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? -1)
    })
  })
}

test.describe('Story 6.5 hosted realtime on the protected preview', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !isPreview(testInfo.project.metadata ?? {}),
      'The hosted realtime probe targets a deployed preview only.'
    )
    // Opt-in: the PR preview check runs test:pw-preview on every push, and this probe holds a
    // socket for about 8 minutes against owner-prepared preview state. Only the dedicated
    // `scope: o1-realtime-probe` dispatch sets this.
    test.skip(
      process.env.O1_REALTIME_PROBE !== '1',
      'Run through the Manual E2E workflow with scope o1-realtime-probe.'
    )
  })

  test('[P0] O1 upgrade, Origin matrix, doorbells, cross-function latency and the 295 s recycle', async ({}, testInfo) => {
    test.setTimeout(9 * 60_000)
    const apiBaseUrl = resolveApiBaseUrl(testInfo)
    const webOrigin = new URL(testInfo.project.use.baseURL ?? '').origin
    const out = testInfo.outputPath('o1-preview-evidence.json')
    await runProbe(
      { PROBE_API_BASE_URL: apiBaseUrl, PROBE_WEB_ORIGIN: webOrigin, PROBE_OUT: out },
      8 * 60_000
    )
    const evidence = JSON.parse(await readFile(out, 'utf8')) as Evidence
    await testInfo.attach('o1-preview-evidence.json', {
      path: out,
      contentType: 'application/json',
    })
    const { claims } = evidence
    expect(evidence.deployment.environment).toBe('preview')
    // Every claim is reported, including what a missing prerequisite left not executed.
    for (const [name, claim] of Object.entries(claims))
      testInfo.annotations.push({
        type: `o1:${name}`,
        description: `${claim.status}${typeof claim.reason === 'string' ? ` (${claim.reason})` : ''}`,
      })
    // Executable on any reachable preview, with or without community access.
    for (const name of ['upgrade101', 'originMatrix'])
      expect(claims[name], `${name}: ${JSON.stringify(claims[name])}`).toMatchObject({
        status: 'pass',
      })
    // A missing prerequisite is 'not-executed'; only a real failure fails the run. Instance
    // placement is Vercel's: two instances are claimed only from two distinct acknowledgements.
    const failed = Object.entries(claims).filter(([, claim]) => claim.status === 'fail')
    expect(failed, JSON.stringify(Object.fromEntries(failed))).toEqual([])
  })

  test('[P0] O1 browser: the web preview opens the hosted socket and renders a doorbell-driven change without refresh', async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.PREVIEW_WEB_FIXTURE_AUTH !== 'true',
      'Needs the web preview to accept a signed-in session: either fixture auth on the preview web build or a real preview Supabase login. Owner prerequisite.'
    )
    const apiBaseUrl = resolveApiBaseUrl(testInfo)
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    const headers = {
      'content-type': 'application/json',
      'x-couture-platform': 'web',
      'x-couture-reactions': '1',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    }
    // Round 8 M2: no write (signup, reaction) unless the API under test is a preview.
    const health = await fetch(`${apiBaseUrl}/api/health`, { headers })
    expect(health.status).toBe(200)
    expect(((await health.json()) as { environment?: string }).environment).toBe(
      'preview'
    )
    const bearer = async () => {
      const signup = await fetch(`${apiBaseUrl}/api/v1/auth/signup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: `preview-browser-${randomUUID()}@example.com`,
          birthdate: '1990-06-15',
        }),
      })
      expect(signup.status).toBe(201)
      const { userId } = (await signup.json()) as { userId: string }
      const claims = {
        sub: userId,
        role: 'guardian',
        e2e: 'couturecast-mobile-e2e',
        exp: Math.floor(Date.now() / 1000) + 1800,
      }
      return `test-token.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.couturecast-mobile-e2e`
    }
    const reader = await bearer()
    const writer = await bearer()
    const frames: string[] = []
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/api/realtime') return
      socket.on('framereceived', ({ payload }) => frames.push(String(payload)))
    })
    await seedWebSession(page.context(), reader)
    await page.goto('/')
    await expect
      .poll(() => frames.some((frame) => frame.startsWith('40/community')))
      .toBe(true)
    const feed = await fetch(`${apiBaseUrl}/api/v1/community/feed?mode=all&limit=12`, {
      headers: { ...headers, authorization: `Bearer ${writer}` },
    })
    const post = (
      (await feed.json()) as {
        data: { items: { id: string; reactions: { revision: number } }[] }
      }
    ).data.items.find((item) => item.id.startsWith('lookbook-'))!
    // A feed-seed post, never the shared read-only City Spotlight cohort, whose
    // seeded posts are newer and lead the all-climates feed.
    const reactions = page.getByTestId(`community-reactions-${post.id}`)
    const label = await reactions
      .getByRole('button', { name: /^Applaud,/ })
      .getAttribute('aria-label')
    const initial = Number(label!.split(',')[1])
    const mark = frames.length
    const changed = await fetch(
      `${apiBaseUrl}/api/v1/community/posts/${post.id}/reaction`,
      {
        method: 'PUT',
        headers: { ...headers, authorization: `Bearer ${writer}` },
        body: JSON.stringify({
          selection: 'applause',
          mutationId: randomUUID(),
          baseRevision: post.reactions.revision,
        }),
      }
    )
    expect(changed.status).toBe(200)
    await expect(
      reactions.getByRole('button', { name: `Applaud, ${initial + 1}`, exact: true })
    ).toBeVisible({ timeout: 10_000 })
    expect(
      frames
        .slice(mark)
        .some(
          (frame) =>
            frame ===
            '42/community,["community:changed",{"version":1,"type":"community:changed"}]'
        )
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('preview-doorbell-render.png') })
  })
})
