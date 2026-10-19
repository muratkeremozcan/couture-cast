-- CreateEnum
CREATE TYPE "CommunityCommentStatus" AS ENUM ('pending_screening', 'published', 'held_for_review', 'blocked', 'screening_failed', 'author_deleted', 'consent_suspended', 'erased');

-- AlterTable
ALTER TABLE "LookbookPost" ADD COLUMN     "comment_publication_sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT,
    "parent_id" TEXT,
    "body" TEXT,
    "locale" TEXT NOT NULL,
    "status" "CommunityCommentStatus" NOT NULL DEFAULT 'pending_screening',
    "publication_sequence" INTEGER,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "screening_reason" TEXT,
    "screening_version" TEXT,

    CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentReceipt" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mutation_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentScreeningOutbox" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "dispatched_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityCommentScreeningOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentReport" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT,
    "reporter_id" TEXT,
    "reason" "CommunityReportReason" NOT NULL,
    "content_snapshot" JSONB,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "routed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "CommunityCommentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentAudit" (
    "id" TEXT NOT NULL,
    "report_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentAnalyticsOutbox" (
    "id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_id" UUID,
    "lease_expires_at" TIMESTAMP(3),

    CONSTRAINT "CommunityCommentAnalyticsOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentAnalyticsSubject" (
    "user_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,

    CONSTRAINT "CommunityCommentAnalyticsSubject_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "CommunityComment_post_id_parent_id_publication_sequence_idx" ON "CommunityComment"("post_id", "parent_id", "publication_sequence");

-- CreateIndex
CREATE INDEX "CommunityComment_user_id_created_at_idx" ON "CommunityComment"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "CommunityComment_status_created_at_idx" ON "CommunityComment"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityComment_post_id_publication_sequence_key" ON "CommunityComment"("post_id", "publication_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentReceipt_comment_id_key" ON "CommunityCommentReceipt"("comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentReceipt_user_id_mutation_id_key" ON "CommunityCommentReceipt"("user_id", "mutation_id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentScreeningOutbox_comment_id_key" ON "CommunityCommentScreeningOutbox"("comment_id");

-- CreateIndex
CREATE INDEX "CommunityCommentScreeningOutbox_dispatched_at_created_at_idx" ON "CommunityCommentScreeningOutbox"("dispatched_at", "created_at");

-- CreateIndex
CREATE INDEX "CommunityCommentReport_reporter_id_accepted_at_idx" ON "CommunityCommentReport"("reporter_id", "accepted_at");

-- CreateIndex
CREATE INDEX "CommunityCommentReport_resolved_at_sla_due_at_idx" ON "CommunityCommentReport"("resolved_at", "sla_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentReport_comment_id_reporter_id_key" ON "CommunityCommentReport"("comment_id", "reporter_id");

-- CreateIndex
CREATE INDEX "CommunityCommentAudit_report_id_idx" ON "CommunityCommentAudit"("report_id");

-- CreateIndex
CREATE INDEX "CommunityCommentAnalyticsOutbox_delivered_at_next_attempt_a_idx" ON "CommunityCommentAnalyticsOutbox"("delivered_at", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentAnalyticsSubject_actor_key" ON "CommunityCommentAnalyticsSubject"("actor");

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "CommunityComment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReceipt" ADD CONSTRAINT "CommunityCommentReceipt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReceipt" ADD CONSTRAINT "CommunityCommentReceipt_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentScreeningOutbox" ADD CONSTRAINT "CommunityCommentScreeningOutbox_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT "CommunityCommentReport_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "CommunityComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT "CommunityCommentReport_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentAudit" ADD CONSTRAINT "CommunityCommentAudit_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "CommunityCommentReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentAnalyticsOutbox" ADD CONSTRAINT "CommunityCommentAnalyticsOutbox_actor_fkey" FOREIGN KEY ("actor") REFERENCES "CommunityCommentAnalyticsSubject"("actor") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentAnalyticsSubject" ADD CONSTRAINT "CommunityCommentAnalyticsSubject_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

