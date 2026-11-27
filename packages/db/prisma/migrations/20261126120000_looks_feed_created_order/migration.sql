-- Story CC-7.12 D3: the Looks tab lists saved looks and capsules newest saved first
-- (`sort=created_desc`, ordered created_at desc, id asc). These indexes match that order per member;
-- SavedLook leaves deleted_at out, since `IS NULL` is a filter that does not fix index order.
CREATE INDEX "SavedLook_user_id_created_at_id_idx" ON "SavedLook"("user_id", "created_at" DESC, "id" ASC);

CREATE INDEX "OutfitCapsule_user_id_created_at_id_idx" ON "OutfitCapsule"("user_id", "created_at" DESC, "id" ASC);
