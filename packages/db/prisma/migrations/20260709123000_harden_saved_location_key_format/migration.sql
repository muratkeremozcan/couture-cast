-- Story 1.2 review hardening: enforce provider-safe canonical saved location keys.

ALTER TABLE public."SavedLocation"
  DROP CONSTRAINT IF EXISTS "SavedLocation_location_key_lowercase_check";

ALTER TABLE public."SavedLocation"
  ADD CONSTRAINT "SavedLocation_location_key_format_check"
  CHECK ("location_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
