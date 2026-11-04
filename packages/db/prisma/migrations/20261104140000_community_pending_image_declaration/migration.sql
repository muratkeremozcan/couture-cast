-- Story 6.11: storage has no transaction, so normalization records what it is about to write before
-- it writes. Bytes that match the pending declaration came from that write, and a later generation
-- can finish the work where it would otherwise see a checksum mismatch.
ALTER TABLE "LookbookPost" ADD COLUMN "image_pending_checksum" TEXT;
ALTER TABLE "LookbookPost" ADD COLUMN "image_pending_byte_size" INTEGER;

-- Set once the stored bytes are normalized, so no later generation re-encodes them.
ALTER TABLE "LookbookPost" ADD COLUMN "image_normalized_at" TIMESTAMP(3);
