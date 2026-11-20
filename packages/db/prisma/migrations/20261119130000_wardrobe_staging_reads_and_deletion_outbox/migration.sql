-- Production follow-up 2026-11-19 (review round 2, Codex findings 4 and 11).
--
-- 1. Staged uploads are service-only. Signed upload URLs write to
--    staging/<userId>/<kind>/<uploadSessionId>.<ext>, bytes no one has verified yet. The member
--    read policy keyed on the second folder segment, and can_read_shared_user_row also admits
--    admin and moderator claims on any segment, so a staging key that carries the owner id would
--    be readable through that predicate. The policy now admits keys under wardrobe/ only.
--
-- 2. WardrobeObjectDeletion is the durable record of every wardrobe-images object the API must
--    remove: garment purge, My Form and selfie replacement, deletion and erasure, commit
--    compensation, a rejected upload's staging key and swept staging keys. A row is written in
--    the same transaction as the state change that orphans the object, the request removes the
--    object at once and deletes the row on success, and the hourly maintenance job retries what
--    is left with backoff. API-only: RLS on, no policies, no client grants.
DO $storage_policy$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS wardrobe_read_authorized ON storage.objects;
    CREATE POLICY wardrobe_read_authorized
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'wardrobe-images'
        AND (storage.foldername(name))[1] = 'wardrobe'
        AND private.can_read_shared_user_row((storage.foldername(name))[2])
      );
  END IF;
END
$storage_policy$;

CREATE TABLE public."WardrobeObjectDeletion" (
    "id" TEXT NOT NULL,
    "object_path" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardrobeObjectDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WardrobeObjectDeletion_object_path_key" ON public."WardrobeObjectDeletion"("object_path");
CREATE INDEX "WardrobeObjectDeletion_not_before_idx" ON public."WardrobeObjectDeletion"("not_before");

REVOKE ALL ON TABLE public."WardrobeObjectDeletion" FROM anon, authenticated;
ALTER TABLE public."WardrobeObjectDeletion" ENABLE ROW LEVEL SECURITY;
