-- DropForeignKey
ALTER TABLE "CommunityReaction" DROP CONSTRAINT "CommunityReaction_post_id_fkey";

-- DropForeignKey
ALTER TABLE "CommunityReaction" DROP CONSTRAINT "CommunityReaction_user_id_fkey";

-- DropForeignKey
ALTER TABLE "CommunityReactionOutbox" DROP CONSTRAINT "CommunityReactionOutbox_post_id_fkey";

-- DropForeignKey
ALTER TABLE "CommunityReactionOutbox" DROP CONSTRAINT "CommunityReactionOutbox_user_id_fkey";

-- DropForeignKey
ALTER TABLE "CommunityReactionReceipt" DROP CONSTRAINT "CommunityReactionReceipt_post_id_fkey";

-- DropForeignKey
ALTER TABLE "CommunityReactionReceipt" DROP CONSTRAINT "CommunityReactionReceipt_user_id_fkey";

-- AddForeignKey
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReactionReceipt" ADD CONSTRAINT "CommunityReactionReceipt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReactionReceipt" ADD CONSTRAINT "CommunityReactionReceipt_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReactionOutbox" ADD CONSTRAINT "CommunityReactionOutbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReactionOutbox" ADD CONSTRAINT "CommunityReactionOutbox_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

