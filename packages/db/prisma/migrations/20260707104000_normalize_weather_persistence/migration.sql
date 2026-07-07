ALTER TABLE "WeatherSnapshot"
  ADD COLUMN "location_key" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "provider_updated_at" TIMESTAMP(3);

UPDATE "WeatherSnapshot"
SET
  "location_key" = lower(regexp_replace(regexp_replace(trim("location"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')),
  "latitude" = 0,
  "longitude" = 0,
  "timezone" = 'UTC',
  "provider" = 'seed',
  "provider_updated_at" = "fetched_at"
WHERE "location_key" IS NULL;

ALTER TABLE "WeatherSnapshot"
  ALTER COLUMN "location_key" SET NOT NULL,
  ALTER COLUMN "latitude" SET NOT NULL,
  ALTER COLUMN "longitude" SET NOT NULL,
  ALTER COLUMN "timezone" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL,
  ALTER COLUMN "provider_updated_at" SET NOT NULL;

ALTER TABLE "ForecastSegment"
  ADD COLUMN "forecast_at" TIMESTAMP(3),
  ADD COLUMN "feels_like" DOUBLE PRECISION,
  ADD COLUMN "precipitation_probability" DOUBLE PRECISION,
  ADD COLUMN "precipitation_amount" DOUBLE PRECISION,
  ADD COLUMN "wind_speed" DOUBLE PRECISION,
  ADD COLUMN "wind_gust" DOUBLE PRECISION,
  ADD COLUMN "provider_weather_code" TEXT;

UPDATE "ForecastSegment" AS segment
SET
  "forecast_at" = snapshot."fetched_at" + (segment."hour_offset" * INTERVAL '1 hour'),
  "feels_like" = segment."temperature",
  "precipitation_probability" = 0,
  "precipitation_amount" = 0,
  "wind_speed" = 0,
  "wind_gust" = NULL,
  "provider_weather_code" = segment."condition"
FROM "WeatherSnapshot" AS snapshot
WHERE segment."weather_snapshot_id" = snapshot."id"
  AND segment."forecast_at" IS NULL;

ALTER TABLE "ForecastSegment"
  ALTER COLUMN "forecast_at" SET NOT NULL,
  ALTER COLUMN "feels_like" SET NOT NULL,
  ALTER COLUMN "precipitation_probability" SET NOT NULL,
  ALTER COLUMN "precipitation_amount" SET NOT NULL,
  ALTER COLUMN "wind_speed" SET NOT NULL,
  ALTER COLUMN "provider_weather_code" SET NOT NULL;

CREATE UNIQUE INDEX "WeatherSnapshot_location_key_provider_provider_updated_at_key"
  ON "WeatherSnapshot"("location_key", "provider", "provider_updated_at");

CREATE INDEX "WeatherSnapshot_location_key_fetched_at_idx"
  ON "WeatherSnapshot"("location_key", "fetched_at");

DROP INDEX IF EXISTS "ForecastSegment_weather_snapshot_id_idx";

CREATE INDEX "ForecastSegment_forecast_at_idx"
  ON "ForecastSegment"("forecast_at");

CREATE UNIQUE INDEX "ForecastSegment_weather_snapshot_id_forecast_at_key"
  ON "ForecastSegment"("weather_snapshot_id", "forecast_at");
