-- Pagination: index for the task list's default order (newest first) within an organization. Additive only.

-- CreateIndex
CREATE INDEX "tasks_organizationId_createdAt_idx" ON "tasks"("organizationId", "createdAt");

