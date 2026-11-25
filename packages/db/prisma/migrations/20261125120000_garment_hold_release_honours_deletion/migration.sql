-- Story CC-7.6 D4: a member who deletes a garment under a legal hold gets 204, and the API records
-- the request on the row (`deletion_requested_at`, `retention_trigger`) while the hold stays. When an
-- operator later releases the hold (`legal_hold` to `active`), this trigger turns the release of such a
-- row into `deletion_pending`, so no reader of active garments (closet list, capsule eligibility,
-- outfit and ritual generation, Style this piece, saved looks) ever sees it as active. The hourly
-- retention sweep purges `deletion_pending` rows.
--
-- Only the release transition of a row with a recorded request changes; every other update passes
-- through untouched, and a hold placed on a pending row is never undone here. The conversion also
-- stamps `updated_at`, which the ritual staleness check reads, so a cached or persisted outfit that
-- names the piece is regenerated before the sweep purges it.

CREATE OR REPLACE FUNCTION private.garment_hold_release_honours_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.retention_status = 'legal_hold'
    AND NEW.retention_status = 'active'
    AND NEW.deletion_requested_at IS NOT NULL
    AND NEW.retention_purged_at IS NULL
  THEN
    NEW.retention_status := 'deletion_pending';
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.garment_hold_release_honours_deletion() FROM PUBLIC;

DROP TRIGGER IF EXISTS garment_hold_release_honours_deletion ON public."GarmentItem";
CREATE TRIGGER garment_hold_release_honours_deletion
BEFORE UPDATE OF retention_status ON public."GarmentItem"
FOR EACH ROW
WHEN (OLD.retention_status = 'legal_hold' AND NEW.retention_status = 'active')
EXECUTE FUNCTION private.garment_hold_release_honours_deletion();
