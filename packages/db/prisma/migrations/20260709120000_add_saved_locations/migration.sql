-- Story 1.2: persist user-scoped saved weather locations and enforce tenant isolation.

CREATE TABLE public."SavedLocation" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "location_key" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "timezone" TEXT NOT NULL,
  "city" TEXT,
  "region" TEXT,
  "country" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SavedLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedLocation_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES public."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedLocation_location_key_lowercase_check"
    CHECK ("location_key" = lower("location_key")),
  CONSTRAINT "SavedLocation_latitude_range_check"
    CHECK ("latitude" >= -90 AND "latitude" <= 90),
  CONSTRAINT "SavedLocation_longitude_range_check"
    CHECK ("longitude" >= -180 AND "longitude" <= 180)
);

CREATE UNIQUE INDEX "SavedLocation_user_id_location_key_key"
  ON public."SavedLocation"("user_id", "location_key");

CREATE UNIQUE INDEX "SavedLocation_one_primary_per_user_key"
  ON public."SavedLocation"("user_id")
  WHERE "is_primary" IS TRUE;

CREATE INDEX "SavedLocation_user_id_sort_order_created_at_id_idx"
  ON public."SavedLocation"("user_id", "sort_order", "created_at", "id");

CREATE INDEX "SavedLocation_location_key_idx"
  ON public."SavedLocation"("location_key");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SavedLocation" TO authenticated;
ALTER TABLE public."SavedLocation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."SavedLocation";
CREATE POLICY authenticated_read_own_user_data
  ON public."SavedLocation"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."SavedLocation";
CREATE POLICY authenticated_insert_own_user_data
  ON public."SavedLocation"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."SavedLocation";
CREATE POLICY authenticated_update_own_user_data
  ON public."SavedLocation"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."SavedLocation";
CREATE POLICY authenticated_delete_own_user_data
  ON public."SavedLocation"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));
