-- Clean up duplicate outfit recommendations
DELETE FROM "OutfitRecommendation"
WHERE id NOT IN (
  SELECT MIN(id)
  FROM "OutfitRecommendation"
  GROUP BY user_id, forecast_segment_id, scenario
);

-- CreateIndex
CREATE UNIQUE INDEX "OutfitRecommendation_user_id_forecast_segment_id_scenario_key" ON "OutfitRecommendation"("user_id", "forecast_segment_id", "scenario");
