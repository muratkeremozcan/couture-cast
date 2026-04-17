CREATE TABLE "GuardianInvitation" (
    "id" TEXT NOT NULL,
    "teen_id" TEXT NOT NULL,
    "guardian_email" TEXT NOT NULL,
    "consent_level" "ConsentLevel" NOT NULL DEFAULT 'read_only',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_guardian_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuardianInvitation_teen_id_idx"
ON "GuardianInvitation"("teen_id");

CREATE INDEX "GuardianInvitation_guardian_email_idx"
ON "GuardianInvitation"("guardian_email");

CREATE INDEX "GuardianInvitation_accepted_guardian_id_idx"
ON "GuardianInvitation"("accepted_guardian_id");

CREATE UNIQUE INDEX "GuardianInvitation_open_teen_email_uniq"
ON "GuardianInvitation"("teen_id", "guardian_email")
WHERE "accepted_at" IS NULL;

ALTER TABLE "GuardianInvitation"
ADD CONSTRAINT "GuardianInvitation_teen_id_fkey"
FOREIGN KEY ("teen_id") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GuardianInvitation"
ADD CONSTRAINT "GuardianInvitation_accepted_guardian_id_fkey"
FOREIGN KEY ("accepted_guardian_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
