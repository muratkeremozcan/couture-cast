-- Story 5.2: premium subscription lifecycle — entitlement mirror, append-only
-- billing event log, and Stripe customer mapping.
--
-- Two properties are load-bearing across this whole migration:
--
--   * All three tables are worker-only. They are written exclusively by the API
--     service role (webhooks, reconciliation sweep, refresh pull); a Supabase
--     client must never read or forge entitlement state, because a forgeable
--     PremiumEntitlement row is free Premium. RLS is enabled with zero policies
--     and zero grants, mirroring the 5.1 catalog/conversion block.
--   * BillingEvent is append-only, enforced by an UPDATE-blocking trigger, not
--     by convention. DELETE deliberately stays open: the commerce retention
--     sweep prunes rows at 24 months. The outbox columns (forward_due,
--     forwarded_at, forward_attempts, forward_last_error) are exempted from the
--     block via a column allowlist so the reconciliation sweep can stamp
--     forwards without reopening the financial fields.

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('stripe', 'revenuecat');

-- CreateEnum
CREATE TYPE "EntitlementStore" AS ENUM ('app_store', 'play_store', 'stripe', 'promotional');

-- CreateEnum
CREATE TYPE "PremiumEntitlementStatus" AS ENUM ('active', 'grace_period', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "PremiumEntitlement" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "PremiumEntitlementStatus" NOT NULL,
    "store" "EntitlementStore" NOT NULL,
    "product_id" TEXT NOT NULL,
    "will_renew" BOOLEAN NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_event_occurred_at" TIMESTAMP(3) NOT NULL,
    "last_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" TEXT,
    "store" "EntitlementStore",
    "product_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forward_due" BOOLEAN NOT NULL DEFAULT false,
    "forwarded_at" TIMESTAMP(3),
    "forward_attempts" INTEGER NOT NULL DEFAULT 0,
    "forward_last_error" TEXT,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremiumEntitlement_user_id_key" ON "PremiumEntitlement"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_external_event_id_key" ON "BillingEvent"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "BillingEvent_received_at_idx" ON "BillingEvent"("received_at");

-- CreateIndex
CREATE INDEX "BillingEvent_forward_due_forwarded_at_idx" ON "BillingEvent"("forward_due", "forwarded_at");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_user_id_key" ON "BillingCustomer"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_stripe_customer_id_key" ON "BillingCustomer"("stripe_customer_id");

-- AddForeignKey
ALTER TABLE "PremiumEntitlement" ADD CONSTRAINT "PremiumEntitlement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Check constraints. Prisma cannot express these; premium-schema.spec.ts
-- asserts each one rejects. Product ids stay deliberately unconstrained so the
-- operator can add products without a migration; event ids must never be empty
-- because the (provider, external_event_id) unique index is the idempotency
-- barrier and an empty id would collapse distinct events onto one row.
-- ---------------------------------------------------------------------------
ALTER TABLE "BillingEvent"
  ADD CONSTRAINT "BillingEvent_external_event_id_check"
  CHECK (length("external_event_id") > 0);

ALTER TABLE "PremiumEntitlement"
  ADD CONSTRAINT "PremiumEntitlement_last_event_id_check"
  CHECK (length("last_event_id") > 0);

-- ---------------------------------------------------------------------------
-- Append-only enforcement for BillingEvent, mirroring
-- 20260420160000_harden_audit_log_immutability. UPDATE is blocked unless the
-- change touches only the forward-outbox bookkeeping columns; the financial
-- columns (provider, external_event_id, event_type, store, product_id, payload,
-- occurred_at, received_at, user_id is FK-managed SetNull) are immutable.
-- DELETE is NOT blocked: the retention pruner needs it.
--
-- The user_id column is also mutable-by-trigger because ON DELETE SET NULL is
-- implemented by Postgres as an UPDATE of the referencing row; blocking it
-- would make user erasure impossible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.block_billing_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."external_event_id" IS DISTINCT FROM OLD."external_event_id"
     OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
     OR NEW."store" IS DISTINCT FROM OLD."store"
     OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
     OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
     OR NEW."received_at" IS DISTINCT FROM OLD."received_at"
     OR (NEW."user_id" IS DISTINCT FROM OLD."user_id" AND NEW."user_id" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'BillingEvent rows are append-only; % of financial columns is not allowed', TG_OP
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_billing_event_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS billing_event_block_update ON public."BillingEvent";
CREATE TRIGGER billing_event_block_update
BEFORE UPDATE ON public."BillingEvent"
FOR EACH ROW
EXECUTE FUNCTION private.block_billing_event_mutation();

-- ---------------------------------------------------------------------------
-- RLS: worker-only tables, unreachable by the authenticated and anon roles.
-- Entitlement state is privilege-bearing and billing events are financial
-- records; all access flows through the API service role. RLS enabled with
-- zero policies and zero grants denies everything except the service role.
-- ---------------------------------------------------------------------------
ALTER TABLE public."PremiumEntitlement" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."PremiumEntitlement" FROM authenticated, anon;

ALTER TABLE public."BillingEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."BillingEvent" FROM authenticated, anon;

ALTER TABLE public."BillingCustomer" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."BillingCustomer" FROM authenticated, anon;
