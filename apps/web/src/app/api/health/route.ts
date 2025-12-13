import { NextResponse } from 'next/server'
import { resolveGitMetadata } from '../../../../git-metadata'

export function GET() {
  const { gitSha, gitBranch } = resolveGitMetadata()

  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
  const deployUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined

  return NextResponse.json({
    status: 'ok',
    service: 'couturecast-web',
    environment,
    gitSha,
    gitBranch,
    deployUrl,
    timestamp: new Date().toISOString(),
  })
}
