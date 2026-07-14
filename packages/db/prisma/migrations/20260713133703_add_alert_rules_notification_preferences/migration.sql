-- Story 1.3: persist user-scoped weather alert rules and notification preferences.

CREATE TABLE public."AlertRule" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "rule_type" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlertRule_rule_type_check"
    CHECK ("rule_type" IN ('temperature', 'precipitation', 'severe')),
  CONSTRAINT "AlertRule_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES public."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE public."NotificationPreference" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "quiet_hours_start" TEXT NOT NULL DEFAULT '22:00',
  "quiet_hours_end" TEXT NOT NULL DEFAULT '07:00',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationPreference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES public."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AlertRule_user_id_idx"
  ON public."AlertRule"("user_id");

CREATE UNIQUE INDEX "AlertRule_user_id_rule_type_key"
  ON public."AlertRule"("user_id", "rule_type");

CREATE UNIQUE INDEX "NotificationPreference_user_id_key"
  ON public."NotificationPreference"("user_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AlertRule" TO authenticated;
ALTER TABLE public."AlertRule" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."AlertRule";
CREATE POLICY authenticated_read_own_user_data
  ON public."AlertRule"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."AlertRule";
CREATE POLICY authenticated_insert_own_user_data
  ON public."AlertRule"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."AlertRule";
CREATE POLICY authenticated_update_own_user_data
  ON public."AlertRule"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."AlertRule";
CREATE POLICY authenticated_delete_own_user_data
  ON public."AlertRule"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."NotificationPreference" TO authenticated;
ALTER TABLE public."NotificationPreference" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."NotificationPreference";
CREATE POLICY authenticated_read_own_user_data
  ON public."NotificationPreference"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."NotificationPreference";
CREATE POLICY authenticated_insert_own_user_data
  ON public."NotificationPreference"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."NotificationPreference";
CREATE POLICY authenticated_update_own_user_data
  ON public."NotificationPreference"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."NotificationPreference";
CREATE POLICY authenticated_delete_own_user_data
  ON public."NotificationPreference"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));
