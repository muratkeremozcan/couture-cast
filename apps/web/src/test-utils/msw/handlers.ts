import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/v1/events/poll', () =>
    HttpResponse.json({
      events: [],
      nextSince: null,
    })
  ),
]
