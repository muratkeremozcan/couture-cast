-- Story 5.1: affiliate "Shop this look" commerce catalog, preference, click,
-- and conversion tables.
--
-- Two properties are load-bearing across this whole migration:
--
--   * CommercePartner, AffiliateOffer, and AffiliateConversion carry no user_id.
--     They are operator-managed or machine-written, so RLS is enabled and the
--     `authenticated` role is granted nothing at all, mirroring the worker-only
--     block used for AlertDeliveryOutbox and AlertCooldownReservation.
--   * CommercePreference and AffiliateClick are owner-only via
--     private.can_manage_self_row, deliberately NOT guardian-shared. A
--     purchase-intent trail is not something this story has a mandate to expose
--     to a guardian, so both guardian consent levels are denied.

-- CreateEnum
CREATE TYPE "CommercePartnerStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AffiliateOfferStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AffiliateConversionStatus" AS ENUM ('pending', 'confirmed', 'reversed');

-- CreateTable
CREATE TABLE "CommercePartner" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "allowed_host" TEXT NOT NULL,
    "status" "CommercePartnerStatus" NOT NULL DEFAULT 'inactive',
    "webhook_secret_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateOffer" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "garment_category" "GarmentCategory" NOT NULL,
    "comfort_range" "GarmentComfortRange",
    "locale_region" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deep_link_template" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "AffiliateOfferStatus" NOT NULL DEFAULT 'inactive',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercePreference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "affiliate_ctas_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "recommendation_id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "locale_region" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateConversion" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "affiliate_click_id" TEXT,
    "status" "AffiliateConversionStatus" NOT NULL,
    "order_value_minor_units" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercePartner_slug_key" ON "CommercePartner"("slug");

-- CreateIndex
CREATE INDEX "CommercePartner_status_slug_idx" ON "CommercePartner"("status", "slug");

-- CreateIndex
CREATE INDEX "AffiliateOffer_status_locale_region_garment_category_priori_idx" ON "AffiliateOffer"("status", "locale_region", "garment_category", "priority" DESC);

-- CreateIndex
CREATE INDEX "AffiliateOffer_partner_id_idx" ON "AffiliateOffer"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "CommercePreference_user_id_key" ON "CommercePreference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateClick_token_key" ON "AffiliateClick"("token");

-- CreateIndex
CREATE INDEX "AffiliateClick_user_id_idx" ON "AffiliateClick"("user_id");

-- CreateIndex
CREATE INDEX "AffiliateClick_created_at_idx" ON "AffiliateClick"("created_at");

-- CreateIndex
CREATE INDEX "AffiliateClick_user_id_offer_id_recommendation_id_created_a_idx" ON "AffiliateClick"("user_id", "offer_id", "recommendation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AffiliateConversion_affiliate_click_id_occurred_at_idx" ON "AffiliateConversion"("affiliate_click_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "AffiliateConversion_received_at_idx" ON "AffiliateConversion"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateConversion_partner_id_external_event_id_key" ON "AffiliateConversion"("partner_id", "external_event_id");

-- AddForeignKey
ALTER TABLE "AffiliateOffer" ADD CONSTRAINT "AffiliateOffer_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "CommercePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercePreference" ADD CONSTRAINT "CommercePreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "AffiliateOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "CommercePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateConversion" ADD CONSTRAINT "AffiliateConversion_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "CommercePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateConversion" ADD CONSTRAINT "AffiliateConversion_affiliate_click_id_fkey" FOREIGN KEY ("affiliate_click_id") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Check constraints. Prisma cannot express any of these, so they live here and
-- the accompanying commerce-schema.spec.ts asserts each one rejects.
--
-- webhook_secret_ref is the sharpest of the four. Resolving a partner's signing
-- secret means reading process.env[<value from a database row>], which without
-- a constraint is an unbounded read of ANY environment variable in the process.
-- Pinning the name shape here, and re-checking the same pattern at runtime,
-- turns that into a closed set. Secret VALUES never enter this table.
-- ---------------------------------------------------------------------------
ALTER TABLE "CommercePartner"
  ADD CONSTRAINT "CommercePartner_webhook_secret_ref_check"
  CHECK ("webhook_secret_ref" ~ '^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$');

-- locale_region is the uppercased UI-language region subtag, or the '*'
-- sentinel meaning "published globally". Two to three characters covers both
-- ISO 3166-1 alpha-2 country codes (US, CA) and UN M.49 macro-regions (419).
ALTER TABLE "AffiliateOffer"
  ADD CONSTRAINT "AffiliateOffer_locale_region_check"
  CHECK ("locale_region" = '*' OR "locale_region" ~ '^[A-Z0-9]{2,3}$');

ALTER TABLE "AffiliateClick"
  ADD CONSTRAINT "AffiliateClick_locale_region_check"
  CHECK ("locale_region" = '*' OR "locale_region" ~ '^[A-Z0-9]{2,3}$');

-- Money is integer minor units and never negative. Floating-point money is
-- prohibited repo-wide; the column type already enforces that half.
ALTER TABLE "AffiliateConversion"
  ADD CONSTRAINT "AffiliateConversion_order_value_minor_units_check"
  CHECK ("order_value_minor_units" >= 0);

ALTER TABLE "AffiliateConversion"
  ADD CONSTRAINT "AffiliateConversion_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Concurrency backstop for click dedupe.
--
-- The product rule is a 60-second sliding window, enforced in the service by a
-- read-then-insert. That read-then-insert is not atomic: two activations racing
-- on separate connections both see no prior row and both insert, which AC 2
-- explicitly tests against. A plain (non-unique) index cannot prevent that.
--
-- This unique index buckets by minute, so a concurrent pair always collides and
-- exactly one insert survives; the loser retries and re-reads the winner's row.
-- The minute bucket is deliberately NOT the product rule -- 10:00:59 and
-- 10:01:01 fall in different buckets and both insert, and the service's own
-- 60-second check is what catches those. This index exists only to make the
-- concurrent case impossible, not to define the window.
--
-- The expression makes this index inexpressible in schema.prisma. It is
-- therefore invisible to `prisma migrate diff`, which is safe in one direction
-- only: Prisma will never recreate it, so it must never be dropped by hand.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "AffiliateClick_dedupe_minute_key"
  ON "AffiliateClick"("user_id", "offer_id", "recommendation_id", (date_trunc('minute', "created_at")));

-- ---------------------------------------------------------------------------
-- RLS: owner-only tables.
-- can_manage_self_row grants the owner and an admin actor, and nobody else.
-- Both guardian consent levels resolve to false through it, which is the
-- intended outcome here and is asserted by the AC 5 actor matrix.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."CommercePreference" TO authenticated;
ALTER TABLE public."CommercePreference" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."CommercePreference";
CREATE POLICY authenticated_read_own_user_data
  ON public."CommercePreference"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."CommercePreference";
CREATE POLICY authenticated_insert_own_user_data
  ON public."CommercePreference"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."CommercePreference";
CREATE POLICY authenticated_update_own_user_data
  ON public."CommercePreference"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."CommercePreference";
CREATE POLICY authenticated_delete_own_user_data
  ON public."CommercePreference"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AffiliateClick" TO authenticated;
ALTER TABLE public."AffiliateClick" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."AffiliateClick";
CREATE POLICY authenticated_read_own_user_data
  ON public."AffiliateClick"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."AffiliateClick";
CREATE POLICY authenticated_insert_own_user_data
  ON public."AffiliateClick"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."AffiliateClick";
CREATE POLICY authenticated_update_own_user_data
  ON public."AffiliateClick"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."AffiliateClick";
CREATE POLICY authenticated_delete_own_user_data
  ON public."AffiliateClick"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

-- ---------------------------------------------------------------------------
-- RLS: catalog and conversion tables are unreachable by the authenticated role.
-- These hold no user-authored content and are never read by a client: the
-- catalog is operator-managed, and conversions are written only by the
-- machine-to-machine webhook. RLS is enabled with zero policies and zero
-- grants, which denies everything except the service role.
-- ---------------------------------------------------------------------------
ALTER TABLE public."CommercePartner" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CommercePartner" FROM authenticated, anon;

ALTER TABLE public."AffiliateOffer" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AffiliateOffer" FROM authenticated, anon;

ALTER TABLE public."AffiliateConversion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AffiliateConversion" FROM authenticated, anon;
