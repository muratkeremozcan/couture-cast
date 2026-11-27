ALTER TYPE "SavedLookSource" ADD VALUE 'today';

ALTER TABLE "SavedLook" ADD COLUMN "worn_on" DATE;
