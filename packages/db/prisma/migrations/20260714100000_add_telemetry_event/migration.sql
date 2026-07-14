-- Story 1.4: add telemetry_events table and RLS policies

-- CreateTable
CREATE TABLE public."telemetry_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telemetry_events_event_type_idx" ON public."telemetry_events"("event_type");

-- CreateIndex
CREATE INDEX "telemetry_events_created_at_idx" ON public."telemetry_events"("created_at");

-- CreateIndex
CREATE INDEX "telemetry_events_user_id_idx" ON public."telemetry_events"("user_id");

-- AddForeignKey
ALTER TABLE public."telemetry_events" ADD CONSTRAINT "telemetry_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS Configuration
GRANT SELECT, INSERT ON TABLE public."telemetry_events" TO authenticated;
ALTER TABLE public."telemetry_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_telemetry ON public."telemetry_events";
CREATE POLICY authenticated_read_own_telemetry
  ON public."telemetry_events"
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND private.can_manage_self_row(user_id));

DROP POLICY IF EXISTS authenticated_insert_telemetry ON public."telemetry_events";
CREATE POLICY authenticated_insert_telemetry
  ON public."telemetry_events"
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND private.can_manage_self_row(user_id));

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT ON TABLE public."telemetry_events" TO service_role;
DROP POLICY IF EXISTS service_role_insert_telemetry ON public."telemetry_events";
CREATE POLICY service_role_insert_telemetry
  ON public."telemetry_events"
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);
