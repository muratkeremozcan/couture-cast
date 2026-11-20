-- Production follow-up 2026-11-19 (review round 1, Codex 1): garment, My Form and palette
-- selfie rows hold the storage paths the API's service role reads, moves and deletes. Members
-- could write these rows through PostgREST under own-row RLS, so a member could point a path
-- column at another member's object and steer a service-role storage call at it. No client
-- writes these tables through PostgREST (the API owns every write), so members keep their
-- row-level reads and lose every write.
--
-- Role names are explicit: GRANT/REVOKE naming the current role has crashed Supabase's
-- supautils before.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."GarmentItem", public."SilhouetteProfile", public."PaletteProfile"
  FROM anon, authenticated;

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."GarmentItem";
DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."GarmentItem";
DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."GarmentItem";

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."SilhouetteProfile";
DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."SilhouetteProfile";
DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."SilhouetteProfile";

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."PaletteProfile";
DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."PaletteProfile";
DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."PaletteProfile";
