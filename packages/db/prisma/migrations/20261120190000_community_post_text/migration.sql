ALTER TABLE "LookbookPost"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "text_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "original_text_fingerprint" TEXT;

ALTER TABLE "LookbookPost"
  ADD CONSTRAINT "LookbookPost_text_revision_nonnegative" CHECK ("text_revision" >= 0);
