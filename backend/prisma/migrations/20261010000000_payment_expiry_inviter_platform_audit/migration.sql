-- Additive only: no existing rows are changed or removed.
--  * PaymentStatus.EXPIRED  — checkouts that were never completed.
--  * memberships.invitedById — who sent an invitation (shown on the accept page).
--  * platform_audit_logs     — actions taken by platform administrators.
-- Rollback (only if nothing uses the new values yet):
--   DROP TABLE "platform_audit_logs";
--   ALTER TABLE "memberships" DROP COLUMN "invitedById";
--   PostgreSQL cannot drop an enum value: UPDATE "payments" SET "status"='CANCELLED' WHERE "status"='EXPIRED';
--   then the unused EXPIRED label is harmless.

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "invitedById" UUID;

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

