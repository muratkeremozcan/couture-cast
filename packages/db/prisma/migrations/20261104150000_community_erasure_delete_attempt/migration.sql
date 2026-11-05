-- Story 6.11: when erasure last tried to delete this post's object, written after the attempt settles.
-- It decides when the next delete is due, so a crash before the attempt leaves the row due.
ALTER TABLE "LookbookPost" ADD COLUMN "image_delete_attempted_at" TIMESTAMP(3);
