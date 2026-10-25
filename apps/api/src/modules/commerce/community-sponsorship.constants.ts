/**
 * Story 6.7b: the closed vocabularies of a community sponsorship link.
 *
 * Reasons are codes, never free text, so neither the link row nor its audit row
 * can hold an author name or a contact detail. These lists are the one source
 * the operator command, the service and the tests read. The migration's CHECK
 * constraints in 20261024120000_community_post_sponsorship repeat them, and the
 * operator integration suite proves every code here is accepted by the database
 * and anything else is refused.
 */
export const COMMUNITY_SPONSORSHIP_LINK_REASONS = [
  'partner_campaign',
  'owner_pick',
] as const

export type CommunitySponsorshipLinkReason =
  (typeof COMMUNITY_SPONSORSHIP_LINK_REASONS)[number]

export const COMMUNITY_SPONSORSHIP_END_REASONS = [
  'campaign_ended',
  'author_withdrew',
  'partner_inactive',
  'correction',
] as const

export type CommunitySponsorshipEndReason =
  (typeof COMMUNITY_SPONSORSHIP_END_REASONS)[number]

/**
 * The id of the owner's off-system author agreement record: `agr_` plus a
 * Crockford base32 ULID. Nothing else fits, so a name, an email, a URL or a
 * sentence cannot be stored as an agreement reference.
 */
export const COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN = /^agr_[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * Normalizes an operator-typed agreement reference before it is checked: the
 * prefix is lowercased and the ULID body uppercased, because ULIDs are
 * case-insensitive and are often copied in lowercase. The result must still
 * match {@link COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN}.
 */
export function normalizeAgreementReference(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.slice(0, 4).toLowerCase() !== 'agr_') return trimmed
  return `agr_${trimmed.slice(4).toUpperCase()}`
}

export const COMMUNITY_SPONSORSHIP_LINKED_EVENT = 'community_sponsorship_linked'
export const COMMUNITY_SPONSORSHIP_ENDED_EVENT = 'community_sponsorship_ended'

/**
 * The `AffiliateClick.scenario` stored on every community-surface click, beside
 * `ADVISOR_SCENARIO`. A community click has no `ScenarioOutfit`; its
 * `recommendation_id` is the post id.
 */
export const COMMUNITY_SCENARIO = 'community'
