CREATE TABLE "PhotoAiGrant" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "input_class" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "teen_assented_at" TIMESTAMP(3),
    "guardian_approved_at" TIMESTAMP(3),
    "guardian_consent_id" TEXT,
    CONSTRAINT "PhotoAiGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PhotoAiGrant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PhotoAiGrant_guardian_consent_id_fkey" FOREIGN KEY ("guardian_consent_id") REFERENCES "GuardianConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PhotoAiGrant_scope_check" CHECK (
        ("feature" = 'community-description' AND "input_class" = 'community-photo') OR
        ("feature" IN ('garment-cutout', 'garment-tags') AND "input_class" = 'garment-photo') OR
        ("feature" = 'flat-lay-garments' AND "input_class" = 'flat-lay-photo')
    ),
    CONSTRAINT "PhotoAiGrant_expires_after_decision_check" CHECK ("expires_at" > "granted_at")
);

CREATE INDEX "PhotoAiGrant_user_id_revoked_at_expires_at_idx" ON "PhotoAiGrant"("user_id", "revoked_at", "expires_at");
CREATE INDEX "PhotoAiGrant_guardian_consent_id_idx" ON "PhotoAiGrant"("guardian_consent_id");

REVOKE ALL ON TABLE public."PhotoAiGrant" FROM PUBLIC, anon, authenticated;
ALTER TABLE public."PhotoAiGrant" ENABLE ROW LEVEL SECURITY;
