import { postHogUpstream, proxyPostHogIngest } from '../../../lib/posthog-ingest-proxy'

// Production analytics privacy: posthog-js talks to this same-origin proxy, which
// forwards only what PostHog needs; see src/lib/posthog-ingest-proxy.ts.
export const dynamic = 'force-dynamic'

const upstream = () =>
  postHogUpstream(process.env.POSTHOG_HOST || 'https://us.i.posthog.com')

export function GET(request: Request) {
  return proxyPostHogIngest(request, upstream())
}

export function HEAD(request: Request) {
  return proxyPostHogIngest(request, upstream())
}

export function POST(request: Request) {
  return proxyPostHogIngest(request, upstream())
}
