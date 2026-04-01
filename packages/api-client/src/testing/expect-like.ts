export type ExpectLike = ((
  actual: unknown,
  message?: string
) => {
  toBe(expected: unknown): void
  toBeGreaterThan(expected: number): void
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}) & {
  objectContaining(expected: Record<string, unknown>): unknown
}
