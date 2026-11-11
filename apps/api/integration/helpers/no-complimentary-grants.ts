// Story 6.14: the complimentary seam for suites that never create a grant. Production compositions
// pass the real ComplimentaryAccessService; the complimentary suites do too.
export const noComplimentaryGrants = {
  isActive: (): Promise<boolean> => Promise.resolve(false),
  check: (): Promise<'not_granted'> => Promise.resolve('not_granted'),
}
