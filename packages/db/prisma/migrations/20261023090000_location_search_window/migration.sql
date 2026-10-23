-- Story 1.2b: city search allows at most 30 requests per member per minute.
-- One row per member holds the current fixed window, so the table never grows
-- past the member count and erasure cascades with the user.
CREATE TABLE "LocationSearchWindow" (
  "user_id" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "searches" INTEGER NOT NULL,
  CONSTRAINT "LocationSearchWindow_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "LocationSearchWindow_searches_positive" CHECK ("searches" > 0)
);

ALTER TABLE "LocationSearchWindow"
  ADD CONSTRAINT "LocationSearchWindow_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationSearchWindow" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "LocationSearchWindow" FROM anon, authenticated;
