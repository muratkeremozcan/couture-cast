-- Story 6.1: Community feed by climate band & weekly challenges.
--
-- Reconciles climate band vocabulary into a canonical enum, adds the community
-- post lifecycle, hardens LookbookPost, and creates the challenge, moderation
-- outbox, alias, and report tables.
--
-- RLS posture for this story, and the reason it differs from every other
-- user-owned table in this schema: the community tables are API-only. The
-- story's Boundaries say "Never: Expose cross-user LookbookPost,
-- CommunityChallenge, or ModerationEvent table rows to authenticated clients"
-- and "Never: Permit client-controlled lifecycle fields". A direct-to-Postgres
-- client cannot satisfy either. A published-row SELECT policy leaks user_id,
-- image_object_path, location_key and moderation_engine_version to any
-- authenticated caller, destroying the pseudonymity the story is built on; and
-- the owner UPDATE policy inherited from
-- 20260420113000_add_guardian_shared_rls_policies has no column restriction, so
-- an author could move their own draft to `published` and write their own
-- `moderation_engine_version`, bypassing moderation entirely. Postgres RLS is
-- row-scoped, not column-scoped, so neither hole can be closed with a better
-- predicate. Therefore: RLS enabled, zero policies, zero grants to anon and
-- authenticated. All reads and writes go through the API's own privileged
-- connection -- the schema owner Prisma connects as, which is what
-- "service_role" means everywhere in this schema's comments -- and the API
-- returns the allowlisted projection. Same shape as the worker-only tables in
-- 20260812090000_add_premium_subscription.

-- CreateEnum
CREATE TYPE "ClimateBand" AS ENUM ('cold_wet', 'cold_dry', 'temperate_wet', 'temperate_dry', 'warm_wet', 'warm_dry');

-- CreateEnum
-- Design Notes lifecycle:
--   draft -> uploading -> pending_review -> published | flagged | review_failed -> withdrawn
-- `consent_suspended` hides an already-published post when guardian consent
-- lapses and requires the author to resubmit after fresh consent. Without it a
-- 13-to-15-year-old member's post stays live after consent is revoked.
CREATE TYPE "CommunityPostStatus" AS ENUM ('draft', 'uploading', 'pending_review', 'published', 'flagged', 'review_failed', 'withdrawn', 'consent_suspended');

-- CreateEnum
CREATE TYPE "CommunityReportReason" AS ENUM ('spam', 'harassment', 'inappropriate_content', 'hate_speech', 'violence', 'other');

-- AlterTable LookbookPost: add columns
ALTER TABLE public."LookbookPost"
  ADD COLUMN "status" "CommunityPostStatus" NOT NULL DEFAULT 'draft',
  ADD COLUMN "alt_text" TEXT,
  ADD COLUMN "image_object_path" TEXT,
  ADD COLUMN "image_content_type" TEXT,
  ADD COLUMN "image_checksum" TEXT,
  ADD COLUMN "image_byte_size" INTEGER,
  ADD COLUMN "upload_expires_at" TIMESTAMP(3),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  -- When the author confirmed the alt text that is actually stored on this row.
  -- The Zod contract's `altTextConfirmed: z.literal(true)` refuses an
  -- unconfirmed publish at the HTTP boundary, but a boundary check leaves no
  -- record, so nothing downstream could tell a confirmed caption from an
  -- accepted machine suggestion, and nothing could answer the question the
  -- story's "Never: Publish unconfirmed alt text" boundary actually asks.
  -- Nullable: `draft` and `uploading` rows legitimately have no confirmation
  -- yet.
  ADD COLUMN "alt_text_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "moderation_reason" TEXT,
  ADD COLUMN "moderation_engine_version" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "location_key" TEXT,
  ADD COLUMN "erasure_requested_at" TIMESTAMP(3),
  ADD COLUMN "anonymized_at" TIMESTAMP(3),
  ADD COLUMN "objects_purged_at" TIMESTAMP(3);

-- Migrate pre-existing climate_band string data to the enum.
--
-- Every legacy value becomes NULL, including the two that look mappable.
-- Boundaries: "Never: Infer wetness for legacy rows." The old vocabulary
-- ('temperate', 'cold') recorded temperature only; it carries no evidence about
-- precipitation, so promoting 'temperate' to 'temperate_dry' would invent a
-- wetness fact and then serve it as a filter. NULL is a first-class band state
-- everywhere in this story, so the honest answer is the safe one.
UPDATE public."LookbookPost"
SET "climate_band" = NULL;

ALTER TABLE public."LookbookPost"
  ALTER COLUMN "climate_band" TYPE "ClimateBand"
  USING ("climate_band"::"ClimateBand");

-- Drop unused image_urls column
ALTER TABLE public."LookbookPost" DROP COLUMN IF EXISTS "image_urls";

-- A published row without a published_at has no place in the public cursor
-- ordering below: it would sort as NULL and either vanish from the feed or
-- surface in an unstable position. Terminal publication and its timestamp are
-- one fact, so the database holds them together.
ALTER TABLE public."LookbookPost"
  ADD CONSTRAINT "LookbookPost_published_at_required_when_published"
  CHECK ("status" <> 'published' OR "published_at" IS NOT NULL);

-- The confirmation the story's "Never: Publish unconfirmed alt text" boundary
-- actually asks about. The Zod contract's `altTextConfirmed: z.literal(true)`
-- refuses an unconfirmed publish at the HTTP boundary, but a boundary check
-- leaves no record and is one unguarded code path away from being bypassed.
--
-- Safe because the stamp is strictly earlier than publication, at the STATEMENT
-- level rather than merely within a transaction: `publishWithinQuota` writes
-- `alt_text_confirmed_at` in the same `updateMany` that writes `alt_text` and
-- moves the row `draft -> pending_review`, and the only route to `published`
-- runs through moderation, which requires `pending_review`. Same statement
-- matters on its own: a confirmation recorded separately from the text it
-- confirms would let an edit slip in between, and the row would then claim the
-- author approved wording they never saw.
ALTER TABLE public."LookbookPost"
  ADD CONSTRAINT "LookbookPost_alt_text_confirmed_when_published"
  CHECK ("status" <> 'published' OR "alt_text_confirmed_at" IS NOT NULL);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "LookbookPost_user_id_idempotency_key_key" ON public."LookbookPost"("user_id", "idempotency_key");

-- CreateIndex
--
-- Feed ordering is `published_at, id`, never `created_at`. The public cursor is
-- defined on publication time (Boundaries: "Use `published_at,id` public
-- cursors bound to filter mode"), and the two clocks genuinely differ: a post
-- created before moderation and published after it would page in the wrong slot
-- under created_at, and the acceptance criterion "when moderation completes,
-- then the post appears once under `published_at,id` ordering" would fail.
CREATE INDEX "LookbookPost_climate_band_status_published_at_id_idx" ON public."LookbookPost"("climate_band", "status", "published_at" DESC, "id" DESC);
CREATE INDEX "LookbookPost_status_published_at_id_idx" ON public."LookbookPost"("status", "published_at" DESC, "id" DESC);

-- The abandoned-upload sweep looks for rows whose reservation lapsed, so it
-- needs an index to find them without a sequential scan.
CREATE INDEX "LookbookPost_upload_expires_at_idx" ON public."LookbookPost"("upload_expires_at");

-- Rolling 24-hour submission cap (ten accepted submissions per user). The
-- window is rolling, not bucketed, so the count is a range scan over
-- submitted_at for one user. `submitted_at` is set when a submission is
-- accepted, which is deliberately not created_at: created_at is the allocate
-- time, and a replayed allocate reuses the same row, so counting created_at
-- would charge a retry against the cap.
CREATE INDEX "LookbookPost_user_id_submitted_at_idx" ON public."LookbookPost"("user_id", "submitted_at" DESC);

-- The 72-hour erasure sweep finds rows that asked for erasure and still hold
-- storage objects.
CREATE INDEX "LookbookPost_erasure_requested_at_objects_purged_at_idx" ON public."LookbookPost"("erasure_requested_at", "objects_purged_at");

-- Update foreign keys to CASCADE on deletion
ALTER TABLE public."LookbookPost" DROP CONSTRAINT IF EXISTS "LookbookPost_user_id_fkey";
ALTER TABLE public."LookbookPost" ADD CONSTRAINT "LookbookPost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."EngagementEvent" DROP CONSTRAINT IF EXISTS "EngagementEvent_user_id_fkey";
ALTER TABLE public."EngagementEvent" ADD CONSTRAINT "EngagementEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."EngagementEvent" DROP CONSTRAINT IF EXISTS "EngagementEvent_post_id_fkey";
ALTER TABLE public."EngagementEvent" ADD CONSTRAINT "EngagementEvent_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES public."LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ModerationEvent keeps the post reference but does NOT cascade with it.
--
-- LookbookPost.user_id cascades from User, so deleting an account removes the
-- author's posts. Chaining a second cascade from post to ModerationEvent made
-- account erasure destroy other people's abuse reports: a third party reports a
-- post, the author deletes their account, and the report disappears with it.
-- SetNull keeps the audit row, and the denormalized columns added below keep it
-- meaningful once the post is gone. Same reasoning, and the same shape, as
-- BillingEvent.user_id ("SetNull so financial facts survive account erasure as
-- unattributed rows").
ALTER TABLE public."ModerationEvent" DROP CONSTRAINT IF EXISTS "ModerationEvent_post_id_fkey";
ALTER TABLE public."ModerationEvent" ADD CONSTRAINT "ModerationEvent_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES public."LookbookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."ModerationEvent"
  ADD COLUMN "subject_alias" TEXT,
  ADD COLUMN "content_snapshot" JSONB,
  ADD COLUMN "image_object_path" TEXT,
  -- The engine version an operator's release overrode.
  --
  -- Releasing a flagged post is a human overruling a machine verdict, so the
  -- audit row has to say WHICH version was overruled. Without this the value
  -- has nowhere structured to go and ends up formatted into the free-text
  -- `reason`, which is the pattern this branch already removed once: reporter
  -- free text was being concatenated there, which destroyed the closed enum and
  -- made a changed reason undetectable, and is why CommunityPostReport exists as
  -- its own table. A well-behaved format string is still that pattern.
  --
  -- Holds the overridden engine version and nothing else. The operator is
  -- already named by `reviewed_by_id` on the same row, so this must not
  -- duplicate identity, and NULL is the ordinary case: only a release written
  -- over a machine verdict fills it.
  ADD COLUMN "overridden_engine_version" TEXT;

-- CreateTable CommunityChallenge
CREATE TABLE public."CommunityChallenge" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    -- IANA zone the weekly window is anchored in. NOT NULL and no default,
    -- because the Design Notes rule is a "Monday seven-day IANA-zone window"
    -- and a Monday is not a fact until a zone says which instant it starts at:
    -- the same absolute timestamp is Monday in Auckland and Sunday in Chicago.
    -- Storing the window without its zone would silently pick the server's,
    -- which is how a challenge opens on the wrong day for half its audience.
    -- The contract requires `timeZone` on both admin inputs and on the
    -- projection, so the API always has one to supply.
    "time_zone" TEXT NOT NULL,
    "climate_band" "ClimateBand",
    "copy" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityChallenge_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."CommunityChallenge"
  ADD CONSTRAINT "CommunityChallenge_window_ordered" CHECK ("ends_at" > "starts_at");

-- Transactional overlap protection, "including global rows".
--
-- A challenge with a NULL climate_band is global: it applies to every band, so
-- it must conflict with a band-scoped challenge whose window overlaps it. An
-- equality key over the band (or over coalesce(band,'*')) cannot express that,
-- because '*' and 'cold_wet' are simply different keys and the pair never
-- collides. Modelling each challenge as the SET of bands it occupies does
-- express it: a band-scoped row occupies one slot, a global row occupies all
-- six, and `&&` on the two int4ranges is true exactly when the two challenges
-- compete for the same audience. Paired with `&&` on the time range, the
-- exclusion constraint rejects band-vs-band, global-vs-global and
-- band-vs-global overlaps in one index, with no SERIALIZABLE transaction and no
-- application-level lock. Only active rows participate, so closing a challenge
-- frees its slot.
--
-- The columns are `timestamp without time zone` (Prisma DateTime), so the range
-- is tsrange; tstzrange would need a cast that is not immutable and the index
-- would be rejected.
ALTER TABLE public."CommunityChallenge"
  ADD CONSTRAINT "CommunityChallenge_no_overlap"
  EXCLUDE USING gist (
    (
      CASE "climate_band"
        WHEN 'cold_wet' THEN int4range(0, 1)
        WHEN 'cold_dry' THEN int4range(1, 2)
        WHEN 'temperate_wet' THEN int4range(2, 3)
        WHEN 'temperate_dry' THEN int4range(3, 4)
        WHEN 'warm_wet' THEN int4range(4, 5)
        WHEN 'warm_dry' THEN int4range(5, 6)
        ELSE int4range(0, 6)
      END
    ) WITH &&,
    tsrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityChallenge_slug_key" ON public."CommunityChallenge"("slug");
CREATE INDEX "CommunityChallenge_is_active_starts_at_ends_at_idx" ON public."CommunityChallenge"("is_active", "starts_at", "ends_at");
CREATE INDEX "CommunityChallenge_climate_band_is_active_idx" ON public."CommunityChallenge"("climate_band", "is_active");

-- AlterTable LookbookPost: add challenge_id
ALTER TABLE public."LookbookPost"
  ADD COLUMN "challenge_id" TEXT;

ALTER TABLE public."LookbookPost" DROP CONSTRAINT IF EXISTS "LookbookPost_challenge_id_fkey";
ALTER TABLE public."LookbookPost" ADD CONSTRAINT "LookbookPost_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES public."CommunityChallenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LookbookPost_challenge_id_idx" ON public."LookbookPost"("challenge_id");

-- CreateTable CommunityModerationOutbox
CREATE TABLE public."CommunityModerationOutbox" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityModerationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityModerationOutbox_post_id_key" ON public."CommunityModerationOutbox"("post_id");
CREATE INDEX "CommunityModerationOutbox_dispatched_at_created_at_idx" ON public."CommunityModerationOutbox"("dispatched_at", "created_at");

ALTER TABLE public."CommunityModerationOutbox" ADD CONSTRAINT "CommunityModerationOutbox_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES public."LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CommunityAlias
--
-- The pseudonym is persisted, not derived. Computing it as
-- sha256(userId).slice(0, 4) at read time gives 65,536 unsalted buckets from a
-- public input: an attacker who can guess a user id confirms it by hashing, the
-- alias is stable for the life of the account across every post, and a
-- thousand-viewer beta expects collisions by the birthday bound long before it
-- reaches its target audience. A stored row with a server-generated random
-- suffix is reversible by nobody and unique by constraint.
CREATE TABLE public."CommunityAlias" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityAlias_user_id_key" ON public."CommunityAlias"("user_id");
CREATE UNIQUE INDEX "CommunityAlias_alias_key" ON public."CommunityAlias"("alias");

ALTER TABLE public."CommunityAlias" ADD CONSTRAINT "CommunityAlias_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CommunityPostReport
--
-- Report uniqueness lives here rather than on ModerationEvent. A UNIQUE
-- (post_id, flagged_by_id) on the audit table caps it at one row per actor per
-- post forever, which makes an append-only moderation log impossible: a second
-- decision by the same reviewer on the same post cannot be written at all.
-- Engine-written rows escaped that only because Postgres treats NULLs as
-- distinct. Reports are the thing that needs to be unique per (post, reporter),
-- so they get their own table and ModerationEvent goes back to append-only.
--
-- Both foreign keys are SetNull for the reason ModerationEvent.post_id is:
-- neither the subject's erasure nor the reporter's may destroy a moderation
-- record. The denormalized snapshot, alias and object path keep an orphaned row
-- actionable, and keep a storage object findable after its row loses the post.
CREATE TABLE public."CommunityPostReport" (
    "id" TEXT NOT NULL,
    "post_id" TEXT,
    "reporter_id" TEXT,
    "reason" "CommunityReportReason" NOT NULL,
    "details" TEXT,
    "content_snapshot" JSONB,
    "subject_alias" TEXT,
    "image_object_path" TEXT,
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "CommunityPostReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityPostReport_post_id_reporter_id_key" ON public."CommunityPostReport"("post_id", "reporter_id");
CREATE INDEX "CommunityPostReport_post_id_idx" ON public."CommunityPostReport"("post_id");
CREATE INDEX "CommunityPostReport_reporter_id_idx" ON public."CommunityPostReport"("reporter_id");
CREATE INDEX "CommunityPostReport_resolved_at_sla_due_at_idx" ON public."CommunityPostReport"("resolved_at", "sla_due_at");

ALTER TABLE public."CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES public."LookbookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public."CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ModerationEvent indexes. The UNIQUE (post_id, flagged_by_id) that used to sit
-- here moved to CommunityPostReport above; see that table's comment.
DROP INDEX IF EXISTS public."ModerationEvent_post_id_flagged_by_id_key";
CREATE INDEX "ModerationEvent_post_id_idx" ON public."ModerationEvent"("post_id");
CREATE INDEX "ModerationEvent_flagged_by_id_idx" ON public."ModerationEvent"("flagged_by_id");

-- ---------------------------------------------------------------------------
-- RLS: every community table is API-only. See the header comment for why a
-- read policy cannot be written safely here.
-- ---------------------------------------------------------------------------

-- LookbookPost. The four owner policies come from
-- 20260420113000_add_guardian_shared_rls_policies, which installed them across
-- a table list this one was on; all four are dropped, along with the
-- published-read policy this migration used to add.
REVOKE ALL ON TABLE public."LookbookPost" FROM anon, authenticated;
ALTER TABLE public."LookbookPost" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."LookbookPost";
DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."LookbookPost";
DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."LookbookPost";
DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."LookbookPost";
DROP POLICY IF EXISTS authenticated_read_published_community_posts ON public."LookbookPost";

-- EngagementEvent. Locked down with LookbookPost, and for the same reason.
--
-- 20260420113000_add_guardian_shared_rls_policies put both tables in its
-- self-only list, granting the four DML verbs to `authenticated` with policies
-- checking only `user_id`. Its own comment said they stayed self-scoped "until
-- Story 6 formalizes"; formalizing LookbookPost and leaving this behind was the
-- other half of the same job.
--
-- `EngagementEvent.post_id` is a REQUIRED foreign key to LookbookPost, so an
-- authenticated client with any `post_id` guess gets a post-existence oracle:
-- the insert succeeds for a real post and fails with 23503 for a fabricated
-- one, which distinguishes rows the API deliberately answers 404 for. Proven
-- live before this REVOKE was written, and it was worse than an oracle -- the
-- insert against another user's DRAFT post SUCCEEDED, so a client could attach
-- engagement to content it cannot read. The same grants let a client forge and
-- delete its own engagement rows, which is the aggregate a later story ranks on.
REVOKE ALL ON TABLE public."EngagementEvent" FROM anon, authenticated;
ALTER TABLE public."EngagementEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."EngagementEvent";
DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."EngagementEvent";
DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."EngagementEvent";
DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."EngagementEvent";

-- CommunityChallenge. Editorial rows include unstarted and deactivated
-- challenges, so a `USING (true)` read policy let any authenticated client
-- enumerate the whole editorial calendar ahead of publication. Challenges reach
-- clients as an API projection of the currently active window.
REVOKE ALL ON TABLE public."CommunityChallenge" FROM anon, authenticated;
ALTER TABLE public."CommunityChallenge" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_active_challenges ON public."CommunityChallenge";

-- Worker-only coordination and audit tables. Local Supabase happens to ship no
-- default ACL on `public`, but hosted provisioning normally grants ALL on
-- tables to anon and authenticated, under which an un-enabled table is wide
-- open. Every prior worker-only table in this schema enables RLS explicitly for
-- that reason; see 20260713151000_add_alert_delivery_outbox and
-- 20260812090000_add_premium_subscription.
REVOKE ALL ON TABLE public."CommunityModerationOutbox" FROM anon, authenticated;
ALTER TABLE public."CommunityModerationOutbox" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."ModerationEvent" FROM anon, authenticated;
ALTER TABLE public."ModerationEvent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CommunityAlias" FROM anon, authenticated;
ALTER TABLE public."CommunityAlias" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CommunityPostReport" FROM anon, authenticated;
ALTER TABLE public."CommunityPostReport" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Storage bucket & policy: community-images
--
-- The bucket is private and carries NO client-facing policy at all. The
-- previous policy read the owning user id out of the second path segment,
-- which only worked because the object path embedded the user id -- exactly
-- what the story forbids ("Never: Put user IDs in object paths or signed
-- URLs"), and a signed URL carries its path, so every share leaked the author.
-- The new path shape is `community/<postId>/<random>.<ext>`: opaque, and
-- unlinkable to an account without the database.
--
-- Dropping client access rather than rewriting the predicate against
-- LookbookPost is the choice here. Any surviving client policy would have to
-- re-derive visibility from post status, which is the same row-level
-- reimplementation of the API's projection that leaked columns above, and it
-- would have to stay in step with withdrawal, consent suspension and takedown
-- forever. The API mints short-lived signed URLs on service_role instead, which
-- is one place to get right and the only one the story's media matrix row
-- ("refetch expired URLs; takedown moves or deletes the object") can be
-- implemented in.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      'community-images',
      'community-images',
      false,
      10485760,
      ARRAY['image/jpeg', 'image/png', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS community_read_authorized ON storage.objects;
  END IF;
END
$$;
