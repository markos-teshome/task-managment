-- Stage 1: organization branches, a separate platform-admin identity, branch limits.
--
-- No tenant data is deleted. Order: (1) new structures, (2) data backfill, (3) removal of the old
-- users."isPlatformAdmin" flag only after its holders were copied, (4) constraints Prisma cannot express,
-- (5) verification that aborts the whole migration (it runs in one transaction) if counts are wrong.
-- Data steps are idempotent (NOT EXISTS / ON CONFLICT), so re-running them by hand is safe.
--
-- Rollback / recovery (before anything uses the new features):
--   * Re-add the flag:   ALTER TABLE "users" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
--                        UPDATE "users" u SET "isPlatformAdmin" = true FROM "platform_admins" p WHERE p."email" = u."email";
--   * Then drop: platform_login_challenges, platform_sessions, branch_memberships, projects."branchId",
--     branches, subscription_plans."maxBranches", platform_admins (after re-pointing platform_audit_logs."actorId"),
--     and the enums BranchStatus / PlatformAdminStatus.
--   Restoring from the pre-migration backup is the simplest full recovery.

-- ───────────── 1. Structures ─────────────

CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

ALTER TABLE "projects" ADD COLUMN "branchId" UUID;
ALTER TABLE "subscription_plans" ADD COLUMN "maxBranches" INTEGER;
ALTER TABLE "platform_audit_logs" ADD COLUMN "ipAddress" TEXT;

CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "address" TEXT,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "managerId" UUID,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "branch_memberships" (
    "branchId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branch_memberships_pkey" PRIMARY KEY ("branchId","membershipId")
);

CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "secretHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_login_challenges" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "branches_organizationId_status_idx" ON "branches"("organizationId", "status");
CREATE UNIQUE INDEX "branches_organizationId_name_key" ON "branches"("organizationId", "name");
CREATE UNIQUE INDEX "branches_organizationId_code_key" ON "branches"("organizationId", "code");
CREATE UNIQUE INDEX "branches_id_organizationId_key" ON "branches"("id", "organizationId");
CREATE INDEX "branch_memberships_membershipId_idx" ON "branch_memberships"("membershipId");
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");
CREATE INDEX "platform_sessions_adminId_idx" ON "platform_sessions"("adminId");
CREATE INDEX "platform_login_challenges_adminId_idx" ON "platform_login_challenges"("adminId");
CREATE INDEX "projects_branchId_idx" ON "projects"("branchId");
CREATE INDEX "platform_audit_logs_targetType_targetId_idx" ON "platform_audit_logs"("targetType", "targetId");
-- Exactly one default branch per organization.
CREATE UNIQUE INDEX "branches_one_default_per_organization" ON "branches"("organizationId") WHERE "isDefault";

ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "branches"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_login_challenges" ADD CONSTRAINT "platform_login_challenges_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant consistency Prisma cannot express (optional composite relations). MATCH SIMPLE: not checked while
-- branchId / managerId is NULL. NO ACTION: checked at the end of the statement, so deleting a whole organization
-- (which cascades to both sides) still works.
ALTER TABLE "projects" ADD CONSTRAINT "projects_branch_same_organization_fkey"
    FOREIGN KEY ("branchId", "organizationId") REFERENCES "branches"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_manager_same_organization_fkey"
    FOREIGN KEY ("managerId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ───────────── 2. Data backfill ─────────────

-- 2a. Platform admins become a separate identity. Their password hash is copied (same credentials);
--     their tenant user row is kept untouched (it may have memberships or history).
INSERT INTO "platform_admins" ("id", "email", "firstName", "lastName", "passwordHash", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."email", u."firstName", u."lastName", u."passwordHash",
       CASE WHEN u."status" = 'ACTIVE' THEN 'ACTIVE'::"PlatformAdminStatus" ELSE 'DISABLED'::"PlatformAdminStatus" END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE u."isPlatformAdmin" AND u."passwordHash" IS NOT NULL
ON CONFLICT ("email") DO NOTHING;

-- 2b. Re-point existing platform audit entries from the user to the new platform admin.
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_actorId_fkey";
UPDATE "platform_audit_logs" l SET "actorId" = p."id"
FROM "users" u JOIN "platform_admins" p ON p."email" = u."email"
WHERE l."actorId" = u."id";
UPDATE "platform_audit_logs" SET "actorId" = NULL
WHERE "actorId" IS NOT NULL AND "actorId" NOT IN (SELECT "id" FROM "platform_admins");
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2c. Every organization gets its default branch. Existing projects stay organization-wide (branchId NULL):
--     their access rules do not change.
INSERT INTO "branches" ("id", "organizationId", "name", "isDefault", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Head Office', true, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."organizationId" = o."id" AND b."isDefault");

-- 2d. Branch permissions (normally synced from code at start-up; inserted here so the grants below can refer to them).
INSERT INTO "permissions" ("id", "key", "group", "description") VALUES
    (gen_random_uuid(), 'BRANCH_VIEW', 'Branches', 'See every branch of the organization'),
    (gen_random_uuid(), 'BRANCH_MANAGE', 'Branches', 'Create, edit and archive branches; work across all branches')
ON CONFLICT ("key") DO NOTHING;

-- Existing system roles receive the same branch permissions new organizations get:
-- Owner and Admin both; Manager view. Employees none. Custom roles are left as their owners defined them.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r JOIN "permissions" p ON
     (r."key" IN ('OWNER', 'ADMIN') AND p."key" IN ('BRANCH_VIEW', 'BRANCH_MANAGE'))
  OR (r."key" = 'MANAGER' AND p."key" = 'BRANCH_VIEW')
WHERE r."isSystem"
ON CONFLICT DO NOTHING;

-- 2e. Branch limits for the default plans (assumed defaults, editable by the platform admin).
UPDATE "subscription_plans" SET "maxBranches" = 1 WHERE "code" = 'FREE' AND "maxBranches" IS NULL;
UPDATE "subscription_plans" SET "maxBranches" = 5 WHERE "code" = 'PROFESSIONAL' AND "maxBranches" IS NULL;
-- BUSINESS and custom plans: NULL = unlimited.

-- ───────────── 3. Remove the old shortcut flag ─────────────

DO $$
DECLARE missing INT;
BEGIN
  SELECT COUNT(*) INTO missing FROM "users" u
  WHERE u."isPlatformAdmin" AND u."passwordHash" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "platform_admins" p WHERE p."email" = u."email");
  IF missing <> 0 THEN
    RAISE EXCEPTION '% platform admins were not copied; refusing to drop users.isPlatformAdmin', missing;
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN "isPlatformAdmin";

-- ───────────── 4. Verification (aborts the migration on any mismatch) ─────────────

DO $$
DECLARE
  orgs INT; defaults INT; bad_projects INT;
BEGIN
  SELECT COUNT(*) INTO orgs FROM "organizations";
  SELECT COUNT(*) INTO defaults FROM "branches" WHERE "isDefault";
  IF orgs <> defaults THEN
    RAISE EXCEPTION 'Branch backfill mismatch: % organizations, % default branches', orgs, defaults;
  END IF;
  SELECT COUNT(*) INTO bad_projects FROM "projects" WHERE "branchId" IS NOT NULL;
  IF bad_projects <> 0 THEN
    RAISE EXCEPTION 'Unexpected branch assignment on % projects', bad_projects;
  END IF;
END $$;
