// Moves the real clock of a test process ahead by REAL_CLOCK_OFFSET_DAYS: `Date.now()`, `new Date()`
// and `Date()` read the shifted time; a date built from a value or a string is left as given.
// Loaded with `node --import`, so every Vitest worker gets it through NODE_OPTIONS.
//
// pr-checks' unit-tests-year-ahead job runs the database-free unit suites with it a year ahead. A
// test that pins its clock (vi.useFakeTimers, vi.setSystemTime) replaces Date for that test and is
// unaffected; a test that seeds a fixed date which the code under test compares with the real clock
// (a teen birthdate literal, an expiry from a pinned clock) fails here a year before it fails on
// every pull request. Only JavaScript moves: no database or Prisma engine runs in those suites, so
// nothing else reads a clock that could disagree with the shifted one.
export const REAL_CLOCK_OFFSET = Symbol.for('couture-cast.real-clock-offset-days')

const days = Number(process.env.REAL_CLOCK_OFFSET_DAYS || 0)
if (!Number.isInteger(days)) {
  throw new Error(`REAL_CLOCK_OFFSET_DAYS must be a whole number of days, got ${days}.`)
}

if (days !== 0 && !globalThis.Date[REAL_CLOCK_OFFSET]) {
  const RealDate = globalThis.Date
  const offsetMs = days * 86_400_000
  const now = () => RealDate.now() + offsetMs

  // A function with the real prototype, so `instanceof Date` holds for dates from either constructor.
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(now()).toString()
    return args.length === 0 ? new RealDate(now()) : new RealDate(...args)
  }
  Object.setPrototypeOf(ShiftedDate, RealDate)
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = now
  ShiftedDate[REAL_CLOCK_OFFSET] = days
  globalThis.Date = ShiftedDate
}
