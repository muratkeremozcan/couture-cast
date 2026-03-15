-- Task 8 step 4: durable fallback cache for feature-flag values.
CREATE TABLE "feature_flags" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);
