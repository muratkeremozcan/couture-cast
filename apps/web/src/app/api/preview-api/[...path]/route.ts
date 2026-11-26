import { proxyPreviewApi } from '../../../../lib/preview-api-proxy'

// A preview deployment's /api/v1 lands here through the next.config.ts rewrite; see
// src/lib/preview-api-proxy.ts. Every other deployment answers 404.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Context = { params: Promise<{ path: string[] }> }

async function handle(request: Request, { params }: Context) {
  const { path } = await params
  return proxyPreviewApi(request, path)
}

export const GET = handle
export const HEAD = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
