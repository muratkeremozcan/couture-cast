// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { ServiceUnavailableException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { PREMIUM_THEMES_DISABLED_MESSAGE } from '../../contracts/http.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'
import { PremiumThemeService } from './premium-theme.service.js'

/**
 * Story 5.3: the resolution rules and the write path, unit tier.
 *
 * The Prisma double below is a TINY IN-MEMORY STORE rather than a bag of
 * `mockResolvedValue`s, and that is the point. Decision 8's rule is that reset
 * upserts the row to NULL and never deletes it, which a stub returning a canned
 * value cannot distinguish from a delete-then-recreate. Backing the delegate
 * with a `Map` lets these cases assert what the story actually asks for — after
 * `PUT { theme: null }` exactly one row exists and its `theme` is NULL — and
 * lets a write and a following read agree without hand-rewiring the mock
 * between them.
 *
 * What this tier still cannot prove, stated plainly rather than implied:
 * the unique constraint on `user_id`, the cascade delete, and RLS. Those are
 * database facts and belong to `packages/db`'s schema/RLS specs and the
 * integration tier.
 *
 * The real enum column is the one database fact this tier now reaches partway
 * into. A Postgres enum holding a member the generated client does not know does
 * not hand back a string for `normalizeStoredTheme` to reject; the query engine
 * refuses the row with `P2023` before that. `5.3-API-011c` drives that rejection
 * through the double so the service's own handling of it is covered here, while
 * the fact that Postgres rejects it at all stays where it belongs, in
 * `premium-theme-schema.spec.ts`.
 */

const USER_ID = 'user-1'

type StoredRow = { theme: unknown }

type UpsertArgs = {
  where: { user_id: string }
  create: { user_id: string; theme: unknown }
  update: { theme: unknown }
}

function build(
  overrides: {
    stored?: StoredRow
    entitled?: boolean
    flag?: boolean
    telemetryFails?: boolean
  } = {}
) {
  const rows = new Map<string, StoredRow>()
  if (overrides.stored) {
    rows.set(USER_ID, overrides.stored)
  }

  const premiumThemePreference = {
    findUnique: vi.fn(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(rows.get(where.user_id) ?? null)
    ),
    upsert: vi.fn(({ where, create, update }: UpsertArgs) => {
      const existing = rows.get(where.user_id)
      const next: StoredRow = existing
        ? { ...existing, ...update }
        : { theme: create.theme }
      rows.set(where.user_id, next)
      return Promise.resolve(next)
    }),
    delete: vi.fn(({ where }: { where: { user_id: string } }) => {
      rows.delete(where.user_id)
      return Promise.resolve({})
    }),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  }

  const entitlements = {
    hasPremiumAccess: vi.fn().mockResolvedValue(overrides.entitled ?? true),
  }
  const featureFlags = {
    getFeatureFlag: vi.fn().mockResolvedValue(overrides.flag ?? true),
  }
  const telemetry = {
    captureEvent: overrides.telemetryFails
      ? vi.fn().mockRejectedValue(new Error('PostHog is down'))
      : vi.fn().mockResolvedValue(undefined),
  }

  const service = new PremiumThemeService(
    { premiumThemePreference } as unknown as PrismaClient,
    entitlements as unknown as PremiumEntitlementService,
    featureFlags as unknown as FeatureFlagsService,
    telemetry as unknown as TelemetryService
  )

  return { service, rows, premiumThemePreference, entitlements, featureFlags, telemetry }
}

describe('getTheme: entitlement and preference resolve together (Decision 7)', () => {
  it('returns the stored palette for an entitled caller with the feature on', async () => {
    const { service } = build({ stored: { theme: 'jewel_radiance' } })

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })
  })

  it('reads an absent row and a stored null as the same Default', async () => {
    const absent = await build().service.getTheme(USER_ID)
    const explicitNull = await build({ stored: { theme: null } }).service.getTheme(
      USER_ID
    )

    // Decision 8 allows the two spellings only because nothing may branch on
    // which one it is. This is the assertion that keeps that true.
    expect(absent).toEqual(explicitNull)
    expect(absent).toEqual({ theme: null, isEntitled: true, themesEnabled: true })
  })

  // `5.3-API-011` is the matrix id and belongs to the controller spec's HTTP-level
  // assertion; this is the service-tier sibling, so it carries its own id.
  it('5.3-API-018 resolves a stored key that is no longer a shipped palette to Default', async () => {
    // A palette retired by a later story leaves rows behind. AC 6 forbids the
    // settings page 500ing over one; it renders Default instead.
    const { service } = build({ stored: { theme: 'spring_bloom' } })

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })
  })

  /**
   * The stale-palette fallback against a real column, not a real string.
   *
   * `theme` is a Postgres enum. When the database holds a member this build's
   * generated client does not know — a migration deployed ahead of the app, a
   * rollback, a palette dropped from `schema.prisma` while rows keep the old value —
   * the query engine rejects the row during conversion and `findUnique` throws. It
   * never returns `'spring_bloom'` for `normalizeStoredTheme` to reject, so the test
   * above proves the Zod half and this one proves the half that actually fires in
   * production. Without it AC 6's clean fallback was reachable only in the double.
   */
  it('5.3-API-011c resolves to Default when the stored enum member predates this build', async () => {
    const { service, premiumThemePreference } = build()
    premiumThemePreference.findUnique.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Inconsistent column data', {
        code: 'P2023',
        clientVersion: 'test',
      })
    )

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })
  })

  /**
   * The narrow half of the same guard. A database that is down, a timeout, a dropped
   * table: swallowing those would render Default and report success while nothing
   * works, which is a worse failure than a 500 because it is invisible.
   */
  it('5.3-API-011d lets an infrastructure failure keep propagating', async () => {
    const { service, premiumThemePreference } = build()
    premiumThemePreference.findUnique.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Server has closed the connection', {
        code: 'P1017',
        clientVersion: 'test',
      })
    )

    await expect(service.getTheme(USER_ID)).rejects.toMatchObject({ code: 'P1017' })
  })

  it('hides a stored palette once entitlement lapses, without touching the row', async () => {
    const { service, rows, premiumThemePreference } = build({
      stored: { theme: 'autumn_umber' },
      entitled: false,
    })

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: null,
      isEntitled: false,
      themesEnabled: true,
    })
    // The preference survives the downgrade; only its rendering stops.
    expect(rows.get(USER_ID)).toEqual({ theme: 'autumn_umber' })
    expect(premiumThemePreference.delete).not.toHaveBeenCalled()
    expect(premiumThemePreference.deleteMany).not.toHaveBeenCalled()
  })

  it('still answers with the kill switch off, reporting themesEnabled false', async () => {
    // The GET is deliberately not flag-gated: a client needs the flag state to
    // decide whether the gallery is selectable, and refusing the read outright
    // would make AC 6's clean fallback unreachable.
    const { service } = build({ stored: { theme: 'winter_metallic' }, flag: false })

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: 'winter_metallic',
      isEntitled: true,
      themesEnabled: false,
    })
  })

  it('asks about the acting user only, on every leg of the resolution', async () => {
    const { service, premiumThemePreference, entitlements, featureFlags } = build()

    await service.getTheme(USER_ID)

    expect(premiumThemePreference.findUnique).toHaveBeenCalledWith({
      where: { user_id: USER_ID },
      select: { theme: true },
    })
    expect(entitlements.hasPremiumAccess).toHaveBeenCalledWith(USER_ID)
    expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
      'premium_themes_enabled',
      USER_ID
    )
  })
})

describe('assertThemesEnabled: the premium_themes_enabled kill switch', () => {
  it('throws 503 with the exported message when the flag resolves false', async () => {
    const { service } = build({ flag: false })

    const attempt = service.assertThemesEnabled(USER_ID)
    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(attempt).rejects.toMatchObject({
      message: PREMIUM_THEMES_DISABLED_MESSAGE,
    })
  })

  it('resolves when the flag is on', async () => {
    const { service } = build({ flag: true })

    await expect(service.assertThemesEnabled(USER_ID)).resolves.toBeUndefined()
  })
})

describe('setTheme: reset is an upsert to null, never a delete (Decision 8)', () => {
  it('5.3-API-012 stores a selection and returns the freshly resolved state', async () => {
    const { service, rows, premiumThemePreference } = build()

    await expect(service.setTheme(USER_ID, 'jewel_radiance')).resolves.toEqual({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })
    expect(premiumThemePreference.upsert).toHaveBeenCalledWith({
      where: { user_id: USER_ID },
      create: { user_id: USER_ID, theme: 'jewel_radiance' },
      update: { theme: 'jewel_radiance' },
      select: { theme: true },
    })
    expect(rows.size).toBe(1)
  })

  it('5.3-API-013 leaves exactly one row with theme null on reset, and a following read resolves Default', async () => {
    const { service, rows, premiumThemePreference } = build({
      stored: { theme: 'winter_metallic' },
    })

    await expect(service.setTheme(USER_ID, null)).resolves.toEqual({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })

    // The row survives the reset. A delete-on-reset implementation passes a
    // single-user response assertion and then diverges the moment updated_at
    // or a selection count matters, which is why the row itself is asserted.
    expect(rows.size).toBe(1)
    expect(rows.get(USER_ID)).toEqual({ theme: null })
    expect(premiumThemePreference.delete).not.toHaveBeenCalled()
    expect(premiumThemePreference.deleteMany).not.toHaveBeenCalled()

    await expect(service.getTheme(USER_ID)).resolves.toEqual({
      theme: null,
      isEntitled: true,
      themesEnabled: true,
    })
  })

  it('creates the row on a first selection and updates it on the next', async () => {
    const { service, rows } = build()

    await service.setTheme(USER_ID, 'autumn_umber')
    await service.setTheme(USER_ID, 'winter_metallic')

    expect(rows.size).toBe(1)
    expect(rows.get(USER_ID)).toEqual({ theme: 'winter_metallic' })
  })

  it('refuses the write with 503 before touching the database when the flag is off', async () => {
    const { service, premiumThemePreference, telemetry } = build({ flag: false })

    await expect(service.setTheme(USER_ID, 'jewel_radiance')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
    expect(premiumThemePreference.upsert).not.toHaveBeenCalled()
    expect(telemetry.captureEvent).not.toHaveBeenCalled()
  })
})

describe('setTheme telemetry: pseudonymous, theme-only, fail-open', () => {
  it('emits premium_theme_selected carrying the palette and nothing else', async () => {
    const { service, telemetry } = build()

    await service.setTheme(USER_ID, 'winter_metallic')

    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      USER_ID,
      'premium_theme_selected',
      { theme: 'winter_metallic' }
    )
  })

  it('emits a reset as a selection of null rather than skipping the event', async () => {
    // `theme: null` IS the Default palette, so reverting is a measurable choice
    // and not a missing event.
    const { service, telemetry } = build({ stored: { theme: 'autumn_umber' } })

    await service.setTheme(USER_ID, null)

    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      USER_ID,
      'premium_theme_selected',
      { theme: null }
    )
  })

  it('keeps the write when telemetry throws (fail-open)', async () => {
    const { service, rows } = build({ telemetryFails: true })

    await expect(service.setTheme(USER_ID, 'jewel_radiance')).resolves.toEqual({
      theme: 'jewel_radiance',
      isEntitled: true,
      themesEnabled: true,
    })
    expect(rows.get(USER_ID)).toEqual({ theme: 'jewel_radiance' })
  })
})
