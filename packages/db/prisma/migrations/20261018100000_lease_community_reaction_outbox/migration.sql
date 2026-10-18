-- A committed lease releases the database connection before telemetry/HTTP I/O.
-- A crashed worker can be reclaimed after expiry; settlement is fenced by lease_id.
ALTER TABLE "CommunityReactionOutbox"
  ADD COLUMN lease_id uuid,
  ADD COLUMN lease_expires_at timestamp(3);
