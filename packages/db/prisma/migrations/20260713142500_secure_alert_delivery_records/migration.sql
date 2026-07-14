-- Story 1.3: keep push tokens private and alert cards owner-scoped at the database boundary.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PushToken" TO authenticated;
ALTER TABLE public."PushToken" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."PushToken";
CREATE POLICY authenticated_read_own_user_data
  ON public."PushToken"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."PushToken";
CREATE POLICY authenticated_insert_own_user_data
  ON public."PushToken"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."PushToken";
CREATE POLICY authenticated_update_own_user_data
  ON public."PushToken"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."PushToken";
CREATE POLICY authenticated_delete_own_user_data
  ON public."PushToken"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

GRANT SELECT ON TABLE public."EventEnvelope" TO authenticated;
ALTER TABLE public."EventEnvelope" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_or_global_events
  ON public."EventEnvelope";
CREATE POLICY authenticated_read_own_or_global_events
  ON public."EventEnvelope"
  FOR SELECT
  TO authenticated
  USING (
    "user_id" IS NULL
    OR private.can_manage_self_row("user_id")
  );
