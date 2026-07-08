CREATE TABLE "WeatherIngestionState" (
  "location_key" TEXT NOT NULL,
  "last_provider_failure_at" TIMESTAMP(3),
  "last_provider_success_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WeatherIngestionState_pkey" PRIMARY KEY ("location_key")
);
