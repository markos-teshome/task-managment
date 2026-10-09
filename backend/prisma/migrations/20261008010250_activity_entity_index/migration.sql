-- CreateIndex
CREATE INDEX "activity_logs_organizationId_entityId_idx" ON "activity_logs"("organizationId", "entityId");
