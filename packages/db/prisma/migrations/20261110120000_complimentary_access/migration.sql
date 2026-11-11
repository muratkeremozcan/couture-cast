-- Story 6.14: complimentary full access.
-- An owner grant lives beside the RevenueCat mirror and never inside it, so the ledger
-- sweep, webhooks and refresh cannot expire, overwrite or bill it.
-- One unrevoked grant per member; revoked rows stay as history until account erasure.
-- Worker-only: RLS on, zero policies, nothing granted to client roles.

CREATE TABLE "ComplimentaryAccessGrant" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "granted_by_id" TEXT,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_id" TEXT,
  "revoke_reason" TEXT,

  CONSTRAINT "ComplimentaryAccessGrant_pkey" PRIMARY KEY ("id"),
  -- Trimmed the way the operator trims: every leading and trailing whitespace character,
  -- tabs and line breaks included, so a whitespace-only reason is refused here too.
  CONSTRAINT "ComplimentaryAccessGrant_reason_check" CHECK (
    char_length(regexp_replace("reason", '^[[:space:]]+|[[:space:]]+$', '', 'g')) BETWEEN 1 AND 200
  ),
  CONSTRAINT "ComplimentaryAccessGrant_revoke_reason_check" CHECK (
    "revoke_reason" IS NULL
    OR char_length(regexp_replace("revoke_reason", '^[[:space:]]+|[[:space:]]+$', '', 'g')) BETWEEN 1 AND 200
  ),
  -- A revoke stamps its time and reason together. The revoker may be null afterwards, because
  -- erasing that operator nulls the column; an unrevoked row never names a revoker.
  CONSTRAINT "ComplimentaryAccessGrant_revoke_check" CHECK (
    ("revoked_at" IS NULL) = ("revoke_reason" IS NULL)
    AND ("revoked_at" IS NOT NULL OR "revoked_by_id" IS NULL)
  )
);

CREATE INDEX "ComplimentaryAccessGrant_member_id_idx" ON "ComplimentaryAccessGrant"("member_id");
CREATE INDEX "ComplimentaryAccessGrant_granted_by_id_idx" ON "ComplimentaryAccessGrant"("granted_by_id");
CREATE INDEX "ComplimentaryAccessGrant_revoked_by_id_idx" ON "ComplimentaryAccessGrant"("revoked_by_id");
-- Raw SQL: Prisma cannot express a partial unique index.
CREATE UNIQUE INDEX "ComplimentaryAccessGrant_active_member_key"
  ON "ComplimentaryAccessGrant"("member_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "ComplimentaryAccessGrant"
  ADD CONSTRAINT "ComplimentaryAccessGrant_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessGrant"
  ADD CONSTRAINT "ComplimentaryAccessGrant_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessGrant"
  ADD CONSTRAINT "ComplimentaryAccessGrant_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplimentaryAccessGrant" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ComplimentaryAccessGrant" FROM PUBLIC, anon, authenticated, service_role;
