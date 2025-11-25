-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'granted', 'revoked');

-- CreateEnum
CREATE TYPE "ComfortRun" AS ENUM ('cold', 'neutral', 'warm');

-- CreateEnum
CREATE TYPE "WindTolerance" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "PrecipPreparedness" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "birthdate" TIMESTAMP(3),
    "preferences" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianConsent" (
    "id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "teen_id" TEXT NOT NULL,
    "consent_granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherSnapshot" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "alerts" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSegment" (
    "id" TEXT NOT NULL,
    "weather_snapshot_id" TEXT NOT NULL,
    "hour_offset" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComfortPreferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "runs_cold_warm" "ComfortRun" NOT NULL DEFAULT 'neutral',
    "wind_tolerance" "WindTolerance" NOT NULL DEFAULT 'medium',
    "precip_preparedness" "PrecipPreparedness" NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComfortPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarmentItem" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "image_url" TEXT,
    "category" TEXT NOT NULL,
    "material" TEXT,
    "comfort_range" TEXT,
    "color_palette" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaletteInsights" (
    "id" TEXT NOT NULL,
    "garment_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "undertone" TEXT,
    "hex_codes" JSONB,
    "confidence_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaletteInsights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutfitRecommendation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "forecast_segment_id" TEXT,
    "scenario" TEXT NOT NULL,
    "garment_ids" JSONB,
    "reasoning_badges" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutfitRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookbookPost" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "image_urls" JSONB,
    "caption" TEXT,
    "locale" TEXT,
    "climate_band" TEXT,
    "palette_insight_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookbookPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationEvent" (
    "id" TEXT NOT NULL,
    "post_id" TEXT,
    "garment_item_id" TEXT,
    "flagged_by_id" TEXT,
    "reviewed_by_id" TEXT,
    "action" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_data" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_user_id_key" ON "UserProfile"("user_id");

-- CreateIndex
CREATE INDEX "GuardianConsent_guardian_id_idx" ON "GuardianConsent"("guardian_id");

-- CreateIndex
CREATE INDEX "GuardianConsent_teen_id_idx" ON "GuardianConsent"("teen_id");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianConsent_guardian_id_teen_id_key" ON "GuardianConsent"("guardian_id", "teen_id");

-- CreateIndex
CREATE UNIQUE INDEX "ComfortPreferences_user_id_key" ON "ComfortPreferences"("user_id");

-- CreateIndex
CREATE INDEX "GarmentItem_user_id_idx" ON "GarmentItem"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaletteInsights_garment_item_id_key" ON "PaletteInsights"("garment_item_id");

-- CreateIndex
CREATE INDEX "PaletteInsights_user_id_idx" ON "PaletteInsights"("user_id");

-- CreateIndex
CREATE INDEX "OutfitRecommendation_user_id_idx" ON "OutfitRecommendation"("user_id");

-- CreateIndex
CREATE INDEX "LookbookPost_user_id_idx" ON "LookbookPost"("user_id");

-- CreateIndex
CREATE INDEX "EngagementEvent_user_id_idx" ON "EngagementEvent"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_teen_id_fkey" FOREIGN KEY ("teen_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSegment" ADD CONSTRAINT "ForecastSegment_weather_snapshot_id_fkey" FOREIGN KEY ("weather_snapshot_id") REFERENCES "WeatherSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComfortPreferences" ADD CONSTRAINT "ComfortPreferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentItem" ADD CONSTRAINT "GarmentItem_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaletteInsights" ADD CONSTRAINT "PaletteInsights_garment_item_id_fkey" FOREIGN KEY ("garment_item_id") REFERENCES "GarmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaletteInsights" ADD CONSTRAINT "PaletteInsights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitRecommendation" ADD CONSTRAINT "OutfitRecommendation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitRecommendation" ADD CONSTRAINT "OutfitRecommendation_forecast_segment_id_fkey" FOREIGN KEY ("forecast_segment_id") REFERENCES "ForecastSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookbookPost" ADD CONSTRAINT "LookbookPost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookbookPost" ADD CONSTRAINT "LookbookPost_palette_insight_id_fkey" FOREIGN KEY ("palette_insight_id") REFERENCES "PaletteInsights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_garment_item_id_fkey" FOREIGN KEY ("garment_item_id") REFERENCES "GarmentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_flagged_by_id_fkey" FOREIGN KEY ("flagged_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
