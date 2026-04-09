import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('https://example.test/api/health', () =>
    HttpResponse.json({
      status: 'ok',
      service: 'couturecast-api',
      environment: 'test',
      gitSha: 'test-git-sha',
      gitBranch: 'test-git-branch',
      timestamp: '2026-04-09T00:00:00.000Z',
    })
  ),
]
