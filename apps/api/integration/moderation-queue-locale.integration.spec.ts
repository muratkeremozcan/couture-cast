// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 review finding 12: the locale a queue filter matches is the locale the detail shows.
// A case takes the locale of its earliest report (its snapshot locale, else the live target's),
// and a value the contract cannot carry reads as no locale in both places.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
} from '@couture/api-client/contracts/http'
import { moderationQueueTestContext } from './helpers/moderation-queue-context.js'
import {
  SEED_HOUR_MS,
  SEED_MINUTE_MS,
  newRunId,
  seedMember,
  seedPost,
  seedPostReport,
} from './helpers/moderation-queue-seed.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const ctx = moderationQueueTestContext()
const { prisma, clock } = ctx
const runId = newRunId()
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * SEED_MINUTE_MS)
const due = new Date(NOW.getTime() + 10 * SEED_HOUR_MS)

type Moderator = ReturnType<Awaited<ReturnType<typeof ctx.bootApp>>['as']>
let moderator: Moderator
const caseIds: Record<string, string> = {}

const snapshot = (locale: unknown) => ({ caption: 'seen', altText: 'seen', locale })

beforeAll(async () => {
  clock.at(NOW)
  const mod = await seedMember(prisma, runId, 'moderator', { alias: false })
  const author = await seedMember(prisma, runId, 'author')
  const r1 = await seedMember(prisma, runId, 'r1')
  const r2 = await seedMember(prisma, runId, 'r2')

  const cases: {
    label: string
    live: string | null
    reports: [unknown, unknown?][]
  }[] = [
    // Two reports with different locales: the earlier one decides.
    { label: 'multi', live: 'fr-FR', reports: [['es-419', 'de-DE']] },
    // The earliest snapshot locale is unusable, so the live locale decides, not the later report.
    { label: 'garbage', live: 'it-IT', reports: [['x'.repeat(40), 'de-DE']] },
    // Nothing usable anywhere.
    { label: 'none', live: null, reports: [['en_US', 'x'.repeat(40)]] },
  ]
  for (const entry of cases) {
    const post = await seedPost(prisma, {
      runId,
      label: entry.label,
      authorId: author.id,
      locale: entry.live,
      now: NOW,
    })
    caseIds[entry.label] = `post.${post.id}`
    const [first, second] = entry.reports[0]!
    await seedPostReport(prisma, {
      runId,
      label: `${entry.label}-1`,
      postId: post.id,
      reporterId: r1.id,
      reason: 'spam',
      createdAt: ago(30),
      dueAt: due,
      snapshot: snapshot(first),
    })
    await seedPostReport(prisma, {
      runId,
      label: `${entry.label}-2`,
      postId: post.id,
      reporterId: r2.id,
      reason: 'spam',
      createdAt: ago(10),
      dueAt: due,
      snapshot: snapshot(second),
    })
  }
  const boot = await ctx.bootApp()
  moderator = boot.as('moderator', mod.id)
}, 120_000)

const localeOf = async (label: string) => {
  const list = moderationCasesResponseSchema.parse(
    (await moderator.get('/api/v1/moderation/cases?limit=50')).body
  )
  const item = list.data.items.find((entry) => entry.caseId === caseIds[label])
  const detail = moderationCaseDetailResponseSchema.parse(
    (await moderator.get(`/api/v1/moderation/cases/${caseIds[label]}`)).body
  )
  return { list: item?.locale, detail: detail.data.locale }
}
const filtered = async (locale: string) => {
  const body = moderationCasesResponseSchema.parse(
    (await moderator.get(`/api/v1/moderation/cases?limit=50&locale=${locale}`)).body
  )
  return body.data.items.map((item) => item.caseId)
}

describe('review finding 12: the list and the detail agree on the locale', () => {
  it('a multi-report case shows the earliest report locale in both places', async () => {
    expect(await localeOf('multi')).toEqual({ list: 'es-419', detail: 'es-419' })
  })

  it('a filter matches only the locale the case shows', async () => {
    expect(await filtered('es-419')).toContain(caseIds.multi)
    // A later report in de-DE must not make the case match a de-DE filter.
    expect(await filtered('de-DE')).not.toContain(caseIds.multi)
    expect(await filtered('de-DE')).not.toContain(caseIds.garbage)
  })

  it('an unusable earliest snapshot locale falls back to the live locale, never to another report', async () => {
    expect(await localeOf('garbage')).toEqual({ list: 'it-IT', detail: 'it-IT' })
    expect(await filtered('it-IT')).toContain(caseIds.garbage)
  })

  it('a value the contract cannot carry is no locale in both places, and locale=unknown finds it', async () => {
    expect(await localeOf('none')).toEqual({ list: null, detail: null })
    const unknown = await filtered('unknown')
    expect(unknown).toContain(caseIds.none)
    expect(unknown).not.toContain(caseIds.multi)
  })

  it('answers every one of these cases with 200, never a 500', async () => {
    for (const label of Object.keys(caseIds)) {
      expect(
        (await moderator.get(`/api/v1/moderation/cases/${caseIds[label]}`)).status
      ).toBe(200)
    }
    expect((await moderator.get('/api/v1/moderation/cases?limit=50')).status).toBe(200)
  })
})
