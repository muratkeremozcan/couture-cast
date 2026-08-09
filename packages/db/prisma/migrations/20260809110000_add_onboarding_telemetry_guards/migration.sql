-- Story 4.4 Task 3: exactly-once emission guards for the two onboarding
-- telemetry events. Row creation alone makes wardrobe_onboarding_started
-- exactly-once for the happy path, but a crash between commit and emission
-- followed by an identical-payload PATCH replay must not re-emit either
-- event, so both events get the same emitted-at-guarded-updateMany pattern
-- GarmentItem already uses for completion_telemetry_emitted_at.
ALTER TABLE "WardrobeOnboardingState"
  ADD COLUMN "started_telemetry_emitted_at" TIMESTAMP(3),
  ADD COLUMN "completed_telemetry_emitted_at" TIMESTAMP(3);
