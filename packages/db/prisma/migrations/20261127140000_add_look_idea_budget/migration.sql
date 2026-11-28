CREATE TABLE "LookIdeaDailyQuota" (
    "user_id" TEXT NOT NULL,
    "utc_day" DATE NOT NULL,
    "dispatch_count" INTEGER NOT NULL,
    CONSTRAINT "LookIdeaDailyQuota_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "LookIdeaDailyQuota_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LookIdeaDailyQuota_dispatch_count_check" CHECK ("dispatch_count" BETWEEN 1 AND 3)
);

CREATE TABLE "LookIdeaBudget" (
    "id" INTEGER NOT NULL,
    "dispatch_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LookIdeaBudget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LookIdeaBudget_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "LookIdeaBudget_dispatch_count_check" CHECK ("dispatch_count" BETWEEN 0 AND 500)
);

INSERT INTO "LookIdeaBudget" ("id") VALUES (1);

REVOKE ALL ON TABLE public."LookIdeaDailyQuota", public."LookIdeaBudget" FROM PUBLIC, anon, authenticated;
ALTER TABLE public."LookIdeaDailyQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LookIdeaBudget" ENABLE ROW LEVEL SECURITY;
