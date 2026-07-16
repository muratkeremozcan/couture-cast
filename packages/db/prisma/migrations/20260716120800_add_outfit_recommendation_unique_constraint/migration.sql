-- CreateIndex
CREATE UNIQUE INDEX "OutfitRecommendation_user_id_forecast_segment_id_scenario_key" ON "OutfitRecommendation"("user_id", "forecast_segment_id", "scenario");
