-- Story 0.11 Task 5: harden audit log storage for guardian consent events.
--
-- Guard against accidental or malicious mutation of historical audit rows while
-- keeping read access constrained to admin actors when queried through
-- Supabase-authenticated roles.

CREATE INDEX IF NOT EXISTS "AuditLog_event_type_timestamp_idx"
ON public."AuditLog"("event_type", "timestamp");

CREATE OR REPLACE FUNCTION private.block_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable; % is not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.block_audit_log_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS audit_log_block_update ON public."AuditLog";
CREATE TRIGGER audit_log_block_update
BEFORE UPDATE ON public."AuditLog"
FOR EACH ROW
EXECUTE FUNCTION private.block_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_block_delete ON public."AuditLog";
CREATE TRIGGER audit_log_block_delete
BEFORE DELETE ON public."AuditLog"
FOR EACH ROW
EXECUTE FUNCTION private.block_audit_log_mutation();

GRANT SELECT ON TABLE public."AuditLog" TO authenticated;
ALTER TABLE public."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AuditLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_audit_log ON public."AuditLog";
CREATE POLICY authenticated_read_audit_log
ON public."AuditLog"
FOR SELECT
TO authenticated
USING (private.is_admin_actor());
