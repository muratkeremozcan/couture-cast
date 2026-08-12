import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { fail, sleep } from 'k6'
import { apiUrl, authHeaders, uniqueEmail } from '../helpers/config'
import { type QueueHealthResponse, signUp } from '../helpers/api'
import { getJson } from '../helpers/http'

// ── Scenario: API health ─────────────────────────────────────────────────────

export function testApiHealth() {
  describe('GET /api/health', () => {
    const { status, body } = getJson<{ status: string; service: string }>(
      apiUrl('/api/health'),
      { tags: { name: 'api/health' } }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.status, 'status is ok').to.equal('ok')
    expect(body?.service, 'service name').to.equal('couturecast-api')
  })

  sleep(0.2)
}

// ── Scenario: Realtime poll ──────────────────────────────────────────────────

export function testRealtimePoll() {
  const { status: signupStatus, body: user } = signUp(
    uniqueEmail('poll-user'),
    '1990-05-18'
  )
  if (signupStatus !== 201 || !user) {
    fail(`poll-user signup failed: ${signupStatus}`)
  }

  describe('GET /api/v1/events/poll', () => {
    const since = encodeURIComponent(new Date(Date.now() - 60_000).toISOString())
    const { status, body } = getJson<{ events: unknown[]; nextSince: string | null }>(
      apiUrl(`/api/v1/events/poll?since=${since}`),
      {
        headers: authHeaders(user.userId, 'admin'),
        tags: { name: 'api/events-poll' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.events, 'events is array').to.be.an('array')
    expect(
      body != null && (body.nextSince === null || typeof body.nextSince === 'string'),
      'cursor is null or string'
    ).to.equal(true)
  })

  sleep(0.2)
}

// ── Scenario: Queue health ───────────────────────────────────────────────────

export function testQueueHealth() {
  describe('GET /api/v1/health/queues', () => {
    const { status, body } = getJson<QueueHealthResponse>(
      apiUrl('/api/v1/health/queues'),
      {
        tags: { name: 'api/queue-health' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.status, 'status is ok').to.equal('ok')
    expect(body?.queues.length, 'at least 4 queues').to.be.at.least(4)
    expect(body?.queues, 'includes weather-ingestion').to.include('weather-ingestion')
    expect(body?.queues, 'includes alert-fanout').to.include('alert-fanout')
  })

  sleep(0.2)
}
