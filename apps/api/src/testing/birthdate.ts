/**
 * A birthdate that makes someone `age` years old on `today`, half a year past the birthday.
 *
 * Age checks read the clock they run on, so a literal birthdate in a test turns into a different
 * age every year: '2012-01-01' was a teen in 2026 and is an adult from 2030. Build birthdates from
 * the clock the code under test reads (the real clock by default, or the suite's pinned clock), and
 * the half-year margin keeps the age the same across time zones and a few months of clock skew.
 */
export function birthdateForAge(age: number, today: Date = new Date()): Date {
  const birthday = Date.UTC(
    today.getUTCFullYear() - age,
    today.getUTCMonth(),
    today.getUTCDate()
  )
  return new Date(birthday - 182 * 86_400_000)
}
