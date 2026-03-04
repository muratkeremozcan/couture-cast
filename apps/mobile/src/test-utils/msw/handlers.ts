import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('https://example.test/health', () =>
    HttpResponse.json({
      ok: true,
    })
  ),
]
