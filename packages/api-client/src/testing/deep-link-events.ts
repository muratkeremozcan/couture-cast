const timestamp = '2026-07-30T12:00:00.000Z'

function polledEvent(id: string, channel: string, userId: string, data: unknown) {
  return {
    id,
    channel,
    userId,
    createdAt: timestamp,
    payload: { version: '1', timestamp, userId, data },
  }
}

export function createWeatherAlertPolledEvent(id: string, userId: string) {
  return polledEvent(id, 'alert:weather', userId, {
    alertType: 'severe',
    location: 'Chicago',
    message: 'A severe thunderstorm warning is active.',
    severity: 'critical',
  })
}

export function createCommunityPolledEvent(postId: string, userId: string) {
  return polledEvent(`event-${postId}`, 'lookbook:new', userId, {
    postId,
    locale: 'en-US',
    climateBand: 'Rain-ready',
  })
}
