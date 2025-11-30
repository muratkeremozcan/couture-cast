-- CreateIndex
CREATE INDEX "JobFailure_queue_name_idx" ON "JobFailure"("queue_name");

-- CreateIndex
CREATE INDEX "JobFailure_failed_at_idx" ON "JobFailure"("failed_at");

-- CreateIndex
CREATE INDEX "JobFailure_job_id_queue_name_idx" ON "JobFailure"("job_id", "queue_name");
