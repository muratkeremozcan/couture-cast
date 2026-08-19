-- Story 5.3: premium theme switcher — the per-user palette preference.
--
-- Two properties are load-bearing here:
--
--   * PremiumThemePreference is owner-only, the same posture CommercePreference
--     took in 20260811090000_add_commerce_affiliate. It is a cosmetic
--     preference, not privilege-bearing state, so unlike the 5.2 billing tables
--     the authenticated owner reads and writes it directly through RLS. Both
--     guardian consent levels resolve to false through
--     private.can_manage_self_row, which is the intended outcome and is
--     asserted by the actor matrix in rls-policies.spec.ts.
--   * `theme` is NULLABLE and NULL means Default. Reset is an upsert to NULL,
--     never a DELETE, so an absent row and a NULL row are two spellings of the
--     same fact by design; nothing may branch on which one it is. The enum
--     therefore carries no `default`/`none` member.

-- CreateEnum
CREATE TYPE "PremiumThemeKey" AS ENUM ('jewel_radiance', 'autumn_umber', 'winter_metallic');

-- CreateTable
CREATE TABLE "PremiumThemePreference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme" "PremiumThemeKey",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumThemePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremiumThemePreference_user_id_key" ON "PremiumThemePreference"("user_id");

-- AddForeignKey
ALTER TABLE "PremiumThemePreference" ADD CONSTRAINT "PremiumThemePreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: owner-only table.
-- can_manage_self_row grants the owner and an admin actor, and nobody else.
-- Both guardian consent levels resolve to false through it, which is the
-- intended outcome here and is asserted by the AC 8 actor matrix.
--
-- The four policy names below are not decorative: rls-policies.spec.ts asserts
-- that every table in its selfOnlyTables list carries exactly this set, so a
-- renamed policy is a failing test rather than a silent drift.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PremiumThemePreference" TO authenticated;
ALTER TABLE public."PremiumThemePreference" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."PremiumThemePreference";
CREATE POLICY authenticated_read_own_user_data
  ON public."PremiumThemePreference"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."PremiumThemePreference";
CREATE POLICY authenticated_insert_own_user_data
  ON public."PremiumThemePreference"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."PremiumThemePreference";
CREATE POLICY authenticated_update_own_user_data
  ON public."PremiumThemePreference"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."PremiumThemePreference";
CREATE POLICY authenticated_delete_own_user_data
  ON public."PremiumThemePreference"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));
