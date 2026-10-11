-- Platform admin password recovery: hashed, single-use, 15-minute reset links. Additive only.

-- CreateTable
CREATE TABLE "platform_password_resets" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_password_resets_tokenHash_key" ON "platform_password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "platform_password_resets_adminId_idx" ON "platform_password_resets"("adminId");

-- AddForeignKey
ALTER TABLE "platform_password_resets" ADD CONSTRAINT "platform_password_resets_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

