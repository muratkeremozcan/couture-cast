import { randomBytes } from 'node:crypto'

/**
 * How many hex characters of randomness the visible alias carries.
 *
 * The previous derivation took four characters of an UNKEYED `sha256(userId)`.
 * That is 65,536 buckets over an enumerable input, so anyone holding a list of
 * candidate user ids could confirm authorship by hashing, and roughly one pair
 * of authors in every three hundred shared a suffix — well inside the story's
 * thousand-viewer beta. Eight random characters give about 4.3 billion, and the
 * `CommunityAlias.alias` unique constraint turns the remaining collision risk
 * into a retry rather than two authors sharing a name.
 */
const ALIAS_SUFFIX_LENGTH = 8

/**
 * Mints a candidate alias. The value is NOT derived from the user id at all:
 * `CommunityAlias(user_id unique, alias unique)` stores the association, so the
 * alias needs no relationship to its owner and therefore cannot be inverted back
 * to one. `CommunityRepository.resolveAlias` persists it on first use and
 * returns the stored value on every call after that.
 */
export function generateCommunityAuthorAlias(): string {
  const suffix = randomBytes(ALIAS_SUFFIX_LENGTH / 2)
    .toString('hex')
    .toUpperCase()
  return `Style Explorer ${suffix}`
}
