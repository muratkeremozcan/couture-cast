// Story 6.7b: catalog, author, post, link and operator fixtures shared by the
// sponsorship integration suites. Every writer takes the suite's own client, so
// the rows land in that suite's isolated database and nowhere else.
import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  createLookbookPost,
  createUser,
  persistLookbookPost,
  persistUser,
  type LookbookPostFactoryOverrides,
} from '@couture/testing'
import type { CommunitySponsorshipService } from '../../src/modules/commerce/community-sponsorship.service.js'

type Client = PrismaClient | Prisma.TransactionClient

export const SPONSOR_ALLOWED_HOST = 'partner.sponsorship.test'
export const SPONSOR_DEEP_LINK = `https://${SPONSOR_ALLOWED_HOST}/look?cc={clickToken}`

/**
 * A sponsorship service that resolves no blocks, for controller fixtures whose
 * suites do not exercise the opt-in header.
 */
export const noSponsorships: Pick<
  CommunitySponsorshipService,
  'resolveForPosts' | 'isClickable'
> = {
  resolveForPosts: () => Promise.resolve(new Map()),
  isClickable: () => Promise.resolve(false),
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A fresh `agr_` ULID reference, the only shape the operator accepts. */
export function agreementReference(): string {
  let body = ''
  for (let index = 0; index < 26; index += 1) {
    body += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)]
  }
  return `agr_${body}`
}

/** The database clock in the frame the window columns use: naive UTC. */
export async function databaseNow(client: Client): Promise<Date> {
  const rows = await client.$queryRaw<{ now: Date }[]>(
    Prisma.sql`SELECT (now() AT TIME ZONE 'UTC') AS now`
  )
  const now = rows[0]?.now
  if (!(now instanceof Date)) throw new Error('database clock unavailable')
  return now
}

export function shift(base: Date, milliseconds: number): Date {
  return new Date(base.getTime() + milliseconds)
}

export const HOUR = 3_600_000

/**
 * The isolated databases have no Supabase `auth` tables. The operator resolves
 * its actor through `auth.users`, so this creates the three columns it reads.
 */
export async function installAuthUsers(client: Client): Promise<void> {
  await client.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb)'
  )
}

export async function insertAuthUser(
  client: Client,
  email: string,
  appMetadata: Record<string, unknown> | null
): Promise<string> {
  const id = randomUUID()
  await client.$executeRaw`
    INSERT INTO auth.users (id, email, raw_app_meta_data)
    VALUES (${id}::uuid, ${email}, ${appMetadata === null ? null : JSON.stringify(appMetadata)}::jsonb)
  `
  return id
}

/** An owner: an `admin` auth user and the app user with the same email. */
export async function seedAdmin(
  client: Client,
  label = 'owner'
): Promise<{ email: string; userId: string }> {
  const email = `${label}-${randomUUID()}@sponsorship.test`
  await installAuthUsers(client)
  const user = await client.user.create({ data: { email } })
  await insertAuthUser(client, email, { app_role: 'admin' })
  return { email, userId: user.id }
}

export async function seedPartner(
  client: Client,
  overrides: { status?: 'active' | 'inactive'; displayName?: string } = {}
): Promise<{ id: string; slug: string; displayName: string }> {
  const slug = `sponsor-${randomUUID().slice(0, 12)}`
  const displayName = overrides.displayName ?? `Partner ${slug.slice(-6)}`
  const partner = await client.commercePartner.create({
    data: {
      slug,
      display_name: displayName,
      allowed_host: SPONSOR_ALLOWED_HOST,
      status: overrides.status ?? 'active',
      webhook_secret_ref: 'COMMERCE_PARTNER_SPONSORSHIP_WEBHOOK_SECRET',
    },
  })
  return { id: partner.id, slug: partner.slug, displayName }
}

export type OfferOverrides = {
  status?: 'active' | 'inactive'
  localeRegion?: string
  effectiveFrom?: Date
  effectiveTo?: Date | null
  /** An advisor offer: `advisor_slot` set and no garment category. */
  advisor?: boolean
  title?: string
}

export async function seedOffer(
  client: Client,
  partnerId: string,
  overrides: OfferOverrides = {}
): Promise<{ id: string; title: string }> {
  const title = overrides.title ?? `Sponsored look ${randomUUID().slice(0, 8)}`
  const offer = await client.affiliateOffer.create({
    data: {
      partner_id: partnerId,
      ...(overrides.advisor
        ? { advisor_slot: 'bag' as const, advisor_undertone: 'warm' as const }
        : { garment_category: 'top' as const }),
      locale_region: overrides.localeRegion ?? '*',
      title,
      deep_link_template: SPONSOR_DEEP_LINK,
      priority: 0,
      status: overrides.status ?? 'active',
      effective_from: overrides.effectiveFrom ?? new Date('2020-01-01T00:00:00.000Z'),
      effective_to: overrides.effectiveTo ?? null,
    },
  })
  return { id: offer.id, title }
}

/**
 * A community author. Adult by default; `birthdate: null` leaves the age
 * unknown, and `id` lets a caller mint a canary author id.
 */
export async function seedAuthor(
  client: Client,
  options: {
    birthdate?: Date | null
    id?: string
    locale?: string
  } = {}
): Promise<string> {
  const user = await persistUser(
    client as PrismaClient,
    createUser({
      ...(options.id ? { id: options.id } : {}),
      ...(options.birthdate ? { birthdate: options.birthdate } : {}),
      profilePreferences: {
        compliance: { accountStatus: 'active' },
        ...(options.locale ? { locale: options.locale } : {}),
      },
    })
  )
  if (options.birthdate === null) {
    await client.userProfile.update({
      where: { user_id: user.id },
      data: { birthdate: null },
    })
  }
  return user.id
}

/** A published, publicly visible post unless the overrides say otherwise. */
export async function seedPost(
  client: Client,
  authorId: string,
  overrides: LookbookPostFactoryOverrides = {}
): Promise<string> {
  const post = await persistLookbookPost(
    client as PrismaClient,
    createLookbookPost({
      id: `sponsored-${randomUUID()}`,
      userId: authorId,
      ...overrides,
    })
  )
  return post.id
}

export async function insertLink(
  client: Client,
  input: {
    postId: string
    offerId: string
    createdById: string
    startsAt: Date
    endsAt?: Date | null
    reason?: string
    ended?: { at: Date; byId: string; reason: string }
  }
): Promise<string> {
  const link = await client.communityPostSponsorship.create({
    data: {
      post_id: input.postId,
      offer_id: input.offerId,
      created_by_id: input.createdById,
      create_reason: input.reason ?? 'partner_campaign',
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      ...(input.ended
        ? {
            ended_at: input.ended.at,
            ended_by_id: input.ended.byId,
            end_reason: input.ended.reason,
          }
        : {}),
    },
    select: { id: true },
  })
  return link.id
}

/** Ends an open link the way the operator command does, without its audit row. */
export async function endLink(
  client: Client,
  linkId: string,
  endedById: string
): Promise<void> {
  const now = await databaseNow(client)
  await client.communityPostSponsorship.update({
    where: { id: linkId },
    data: { ended_at: now, ended_by_id: endedById, end_reason: 'campaign_ended' },
  })
}
