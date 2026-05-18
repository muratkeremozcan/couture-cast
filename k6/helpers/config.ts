export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '')

export const TEST_ENV = __ENV.TEST_ENV || __ENV.ENVIRONMENT || 'local'

export const infraDelay = Number.parseInt(__ENV.INFRA_DELAY || '0', 10)

const isSmoke = __ENV.K6_RUN_MODE === 'smoke'

export const SLO = isSmoke
  ? {
      aggregate: 5000,
      health: 2000,
      eventsPoll: 3000,
      queueHealth: 3000,
      signup: 5000,
      guardianInvite: 5000,
      guardianAccept: 5000,
      guardianRevoke: 5000,
      userProfile: 3000,
      moderationAction: 3000,
    }
  : {
      aggregate: 1500,
      health: 400,
      eventsPoll: 800,
      queueHealth: 800,
      signup: 1200,
      guardianInvite: 1500,
      guardianAccept: 1800,
      guardianRevoke: 1500,
      userProfile: 800,
      moderationAction: 800,
    }

export function apiUrl(path: string) {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function authHeaders(userId: string, role: string) {
  return {
    Authorization: `Bearer k6-${role}-${userId}`,
    'x-user-id': userId,
    'x-user-role': role,
  }
}

export function uniqueEmail(prefix: string) {
  const suffix = `${Date.now()}-${__VU}-${__ITER}-${Math.random()
    .toString(36)
    .slice(2, 8)}`

  return `${prefix}+${suffix}@k6.couturecast.test`
}
