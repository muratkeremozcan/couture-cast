-- AlterTable
ALTER TABLE "CommunitySubject" ADD COLUMN     "draft_caption_requests" TIMESTAMPTZ(3)[] DEFAULT ARRAY[]::TIMESTAMPTZ(3)[];
