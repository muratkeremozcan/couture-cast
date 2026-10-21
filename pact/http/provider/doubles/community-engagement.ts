import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { CommunityPreferencesService } from '../../../../apps/api/src/modules/community/community-preferences.service.js'
import type { CommunitySyncService } from '../../../../apps/api/src/modules/community/community-sync.service.js'
import type { CommunityTargetsService } from '../../../../apps/api/src/modules/community/community-targets.service.js'
import type { PushRegistrationService } from '../../../../apps/api/src/modules/notifications/push-registration.service.js'
import type { AlertsService } from '../../../../apps/api/src/modules/alerts/alerts.service'
import { getProviderEngagementState } from '../state'

// Dependency outcome doubles only. Real controllers retain auth, validation,
// response schemas and HTTP status. Database isolation/atomicity lives in INT tests.
const legacy = {
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'UTC',
}
const registration = {
  registrationId: 'registration-65',
  bindingGeneration: 2,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: '2026-10-01T12:00:00.000Z',
}
const post = {
  id: 'post-65',
  caption: 'Layered wool.',
  altText: 'A charcoal wool coat.',
  climateBand: 'temperate_dry' as const,
  imageAccess: {
    url: 'https://storage.synthetic.test/post-65.jpg',
    expiresAt: '2026-10-01T13:00:00.000Z',
  },
  createdAt: '2026-10-01T11:00:00.000Z',
  publishedAt: '2026-10-01T12:00:00.000Z',
  status: 'published' as const,
  challengeId: null,
  author: { displayName: 'Explorer', isSelf: false },
  reactions: {
    counts: { applause: 2, love: 0, inspiration: 0 },
    total: 2,
    viewerReaction: null,
    revision: 4,
    generation: 3,
  },
}
const root = {
  id: 'root-65',
  postId: post.id,
  parentId: null,
  body: 'Beautiful layers.',
  author: 'Explorer',
  isOwn: false,
  unavailable: false,
  publicationSequence: 4,
  publishedAt: post.publishedAt,
  replyCount: 1,
}
const reply = {
  ...root,
  id: 'reply-65',
  parentId: root.id,
  publicationSequence: 45,
  replyCount: 0,
}
export function createCommunityEngagementDoubles() {
  const scenario = () => getProviderEngagementState()
  const authorize = () => {
    if (scenario() === 'denied') throw new ForbiddenException('Community access denied.')
    if (scenario() === 'unavailable')
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'unavailable',
        retryAfterSeconds: 2,
        message: 'Community is temporarily unavailable.',
      })
  }
  const snapshot = () => ({
    ...legacy,
    enabled: false,
    timezoneConfigured: false,
    revision: scenario() === 'legacy-updated' ? 'policy-2' : 'policy-1',
  })
  const preferences: Pick<CommunityPreferencesService, 'get' | 'patch'> = {
    get: () => {
      authorize()
      return Promise.resolve(snapshot())
    },
    patch: (_user, input) => {
      authorize()
      const current = snapshot()
      if (input.baseRevision !== current.revision)
        throw new ConflictException({
          statusCode: 409,
          code: 'revision_conflict',
          current,
        })
      const changes = {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.quietHoursEnabled !== undefined
          ? { quietHoursEnabled: input.quietHoursEnabled }
          : {}),
        ...(input.quietHoursStart !== undefined
          ? { quietHoursStart: input.quietHoursStart }
          : {}),
        ...(input.quietHoursEnd !== undefined
          ? { quietHoursEnd: input.quietHoursEnd }
          : {}),
      }
      return Promise.resolve({
        ...current,
        ...changes,
        timezoneConfigured: Boolean(input.timezone) || current.timezoneConfigured,
        revision: 'policy-2',
      })
    },
  }
  const sync: Pick<CommunitySyncService, 'events'> = {
    events: (_owner, _mode, cursor) => {
      authorize()
      if (cursor === 'foreign-cursor')
        throw new BadRequestException({
          statusCode: 400,
          code: 'invalid_cursor',
          message: 'Invalid community cursor.',
        })
      if (cursor === 'old-epoch')
        throw new ConflictException({
          statusCode: 409,
          code: 'resync_required',
          message: 'Community resynchronization required.',
        })
      if (cursor === 'hidden-event')
        return Promise.resolve({
          events: [
            {
              version: 1 as const,
              kind: 'resync' as const,
              resyncRequired: true as const,
            },
          ],
          nextCursor: 'opaque-head-65',
          hasMore: false,
          resyncRequired: true,
        })
      return Promise.resolve({
        events: cursor
          ? [
              {
                version: 1 as const,
                kind: 'post.published' as const,
                postId: post.id,
                communityRevision: '5',
              },
              {
                version: 1 as const,
                kind: 'reactions.changed' as const,
                postId: post.id,
                communityRevision: '6',
              },
              {
                version: 1 as const,
                kind: 'comment.published' as const,
                postId: post.id,
                commentId: reply.id,
                parentId: root.id,
                communityRevision: '7',
              },
              {
                version: 1 as const,
                kind: 'comment.status' as const,
                postId: post.id,
                commentId: 'own-pending-65',
                privateRevision: '2',
              },
            ]
          : [],
        nextCursor: cursor ? 'opaque-next-65' : 'opaque-head-65',
        hasMore: false,
        resyncRequired: false,
      })
    },
  }
  const targets: Pick<CommunityTargetsService, 'resolve'> = {
    resolve: (_owner, input) => {
      authorize()
      return Promise.resolve({
        targets: input.targets.map((target) => {
          if (target.postId !== post.id)
            return { key: target.key, status: 'unavailable' as const }
          const removed = scenario() === 'child-removed'
          return {
            key: target.key,
            status: 'available' as const,
            communityRevision: '7',
            post,
            comment: removed ? null : reply,
            parent: removed ? null : root,
            pageCursor: removed ? null : 'opaque-reply-page',
            parentPageCursor: removed ? null : 'opaque-root-page',
            threadPosition: removed ? null : 45,
          }
        }),
      })
    },
  }
  const registrations: Pick<PushRegistrationService, 'register' | 'list' | 'remove'> = {
    register: () => {
      if (scenario() === 'other-owner')
        throw new ConflictException({
          code: 'binding_changed',
          message: 'Installation binding changed.',
        })
      return Promise.resolve(registration)
    },
    list: () =>
      Promise.resolve({
        registrations: scenario() === 'other-owner' ? [] : [registration],
      }),
    remove: (_owner, id, generation) =>
      Promise.resolve({
        removed:
          scenario() !== 'other-owner' &&
          id === registration.registrationId &&
          generation === registration.bindingGeneration,
      }),
  }
  const alerts: Pick<
    AlertsService,
    'getSettings' | 'updateNotificationPreferences' | 'updateRules'
  > = {
    getSettings: () => Promise.resolve({ preferences: legacy, rules: [] }),
    updateNotificationPreferences: (_owner, input) => Promise.resolve(input),
    updateRules: (_owner, input) => Promise.resolve(input.rules),
  }
  return { preferences, sync, targets, registrations, alerts }
}
