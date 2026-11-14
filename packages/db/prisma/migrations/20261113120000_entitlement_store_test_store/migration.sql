-- Story 6.15 D15: the RevenueCat Test Store as an entitlement store.
-- The API writes it only when TEST_ENV is explicitly local or preview; everywhere else a Test
-- Store event stays record-only and the REST pull refuses it, so production never holds this value.

ALTER TYPE "EntitlementStore" ADD VALUE 'test_store';
