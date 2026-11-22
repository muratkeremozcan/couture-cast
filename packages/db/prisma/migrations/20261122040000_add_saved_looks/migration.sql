-- Story CC-7.2: Account-backed saved looks from Style this piece and Home sample.
-- Intentionally no foreign key to GarmentItem so garment deletion preserves the saved look
-- and allows the API/UI to surface the explicit missing-piece placeholder.

-- CreateEnum
CREATE TYPE "SavedLookSource" AS ENUM ('style_piece', 'home_sample');

-- CreateTable
CREATE TABLE "SavedLook" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "SavedLookSource" NOT NULL,
    "look_id" TEXT NOT NULL,
    "weather" TEXT NOT NULL,
    "title" TEXT,
    "anchor_garment_id" TEXT,
    "anchor_snapshot" JSONB,
    "composition" JSONB NOT NULL,
    "swaps" JSONB NOT NULL,
    "collection" TEXT,
    "comfort" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "idempotency_payload_hash" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedLook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedLook_id_user_id_key" ON "SavedLook"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "SavedLook_user_id_idempotency_key_key" ON "SavedLook"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "SavedLook_user_id_deleted_at_updated_at_id_idx" ON "SavedLook"("user_id", "deleted_at", "updated_at" DESC, "id" ASC);

-- CreateIndex
CREATE INDEX "SavedLook_user_id_source_anchor_garment_id_idx" ON "SavedLook"("user_id", "source", "anchor_garment_id");

-- AddForeignKey
ALTER TABLE "SavedLook" ADD CONSTRAINT "SavedLook_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- API-only access for SavedLook: revoke all direct PostgREST privileges from anon and
-- authenticated so moderators and restricted/suspended accounts cannot bypass the
-- NestJS API ownership, guardian consent, signed URL, and cache-control checks.
REVOKE ALL ON TABLE public."SavedLook" FROM anon;
REVOKE ALL ON TABLE public."SavedLook" FROM authenticated;
ALTER TABLE public."SavedLook" ENABLE ROW LEVEL SECURITY;
