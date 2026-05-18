// Type declarations for k6 jslib URL imports.
// @types/k6 covers the core API. This file only adds jslib CDN modules
// that TypeScript can't resolve (k6 fetches them at runtime).

// k6chaijs: BDD assertions used in test scripts (describe/expect)
declare module 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js' {
  // Minimal Chai-style chainable assertion. Covers the patterns used in k6 test scripts:
  // .to.equal(), .to.be.an(), .to.be.at.least(), .to.include(), .to.not.be.empty
  type Assertion = {
    to: Assertion
    be: Assertion
    not: Assertion
    at: Assertion
    equal(val: unknown): Assertion
    include(val: unknown): Assertion
    an(type: string): Assertion
    least(n: number): Assertion
    empty: Assertion
  }
  function describe(name: string, fn: () => void): void
  function expect(val: unknown, description?: string): Assertion
  export { describe, expect }
}

// k6-summary: colored console output used by handle-summary.ts
declare module 'https://jslib.k6.io/k6-summary/0.1.0/index.js' {
  function textSummary(
    data: unknown,
    options?: { indent?: string; enableColors?: boolean }
  ): string
  export { textSummary }
}
