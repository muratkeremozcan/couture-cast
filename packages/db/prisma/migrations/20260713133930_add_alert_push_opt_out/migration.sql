-- Story 1.3: add the explicit push notification opt-out preference.

ALTER TABLE public."NotificationPreference"
  ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
