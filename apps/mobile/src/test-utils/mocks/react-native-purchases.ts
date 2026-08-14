// Story 5.2: vitest stand-in for `react-native-purchases`.
//
// The real package reaches the RNPurchases native module, which does not exist
// under vitest (browser mode) any more than it does under Expo Go, so the
// vitest config aliases the module here. Tests drive behavior by importing
// this module (any `react-native-purchases` import resolves to it) and giving
// the vi.fn()s per-test implementations; `restoreMocks` clears them between
// tests, so implementations set here would not survive anyway and none are.
//
// The enum values are stand-ins. Production code never hard-codes them: it
// compares an error's `code` against the enum member of whichever module
// instance it loaded, so mock and real stay self-consistent by construction.
import { vi } from 'vitest'

export const PURCHASES_ERROR_CODE = {
  UNKNOWN_ERROR: '0',
  PURCHASE_CANCELLED_ERROR: '1',
  STORE_PROBLEM_ERROR: '2',
  PAYMENT_PENDING_ERROR: '15',
} as const

const Purchases = {
  configure: vi.fn(),
  getOfferings: vi.fn(),
  purchasePackage: vi.fn(),
  restorePurchases: vi.fn(),
  showManageSubscriptions: vi.fn(),
}

export default Purchases
