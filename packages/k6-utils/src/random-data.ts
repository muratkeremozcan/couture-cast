// Random data generators for k6 test scripts.
// Two flavors:
//   - Pure JS (randomEmail, randomElemFromList): zero dependencies, guaranteed unique per iteration
//   - Faker-powered (realisticEmail): realistic-looking data via k6/x/faker (auto-downloaded in k6 v1.2+)

/** Generates a practically unique email like `k6user+1710000000000-a1b2c3@test.k6.io`.
 * Uses timestamp (ms) + 6-char random suffix; collision probability is ~1 in 2 billion per ms.
 * Use when the API deduplicates by email; faker emails can collide at high RPS. */
export function randomEmail(prefix = 'k6user', domain = 'test.k6.io'): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 8)
  return `${prefix}+${ts}-${rand}@${domain}`
}

/**
 * Makes a faker-generated email unique by appending a timestamp + random suffix.
 * Combines realistic names (from k6/x/faker) with guaranteed uniqueness for high-RPS tests.
 *
 * Usage: import faker at the top of your test script, then pass faker.person.email():
 * ```typescript
 *   import faker from 'k6/x/faker'  // k6 v1.2+ auto-downloads the extension
 *   const email = realisticEmail(faker.person.email()) // 'john.doe+1710000000-a1b2c3@gmail.com'
 * ```
 *
 * @param fakerEmail - An email from faker.person.email() (e.g. 'john.doe@gmail.com')
 */
export function realisticEmail(fakerEmail: string): string {
  const [local, domain] = fakerEmail.split('@')
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 8)
  return `${local}+${ts}-${rand}@${domain}`
}

/**
 * Picks a random element from a non-empty array.
 * @throws {Error} if list is empty
 */
export function randomElemFromList<T>(list: T[]): T {
  if (list.length === 0) throw new Error('randomElemFromList: list must not be empty')
  return list[Math.floor(Math.random() * list.length)]!
}
