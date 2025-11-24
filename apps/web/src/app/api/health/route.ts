import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'couturecast-web',
    timestamp: new Date().toISOString(),
  })
}
