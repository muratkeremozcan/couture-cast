-- Story 5.5 Decision 3: nullable daily-forecast projection alongside the
-- existing hourly ForecastSegment rows. Parsed with the canonical Zod
-- schema on every read; a malformed entry is discarded and logged rather
-- than failing the read.

ALTER TABLE "WeatherSnapshot" ADD COLUMN "daily_summaries" JSONB;
