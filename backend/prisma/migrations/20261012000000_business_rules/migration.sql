-- Approved business rules (BUSINESS_RULES_FINAL.md). Additive; no rows deleted except permission grants
-- removed from SYSTEM roles as approved (custom roles are untouched).
--  D-9  organization closure request + CLOSED status (data retained, reversible by the platform)
--  D-3  new permission PROJECT_MANAGE_ALL for Owner and Admin system roles
--  D-1  permanent project deletion becomes owner-only: PROJECT_DELETE removed from Admin system roles
--  D-2  permanent task deletion removed from Manager system roles
-- Rollback: re-grant PROJECT_DELETE to ADMIN / TASK_DELETE to MANAGER system roles, delete PROJECT_MANAGE_ALL
-- grants and permission, drop the four organizations columns (the CLOSED enum label can stay unused).

ALTER TYPE "OrganizationStatus" ADD VALUE 'CLOSED';

ALTER TABLE "organizations"
  ADD COLUMN "closureRequestedAt" TIMESTAMP(3),
  ADD COLUMN "closureReason" TEXT,
  ADD COLUMN "closureRequestedById" UUID,
  ADD COLUMN "closedAt" TIMESTAMP(3);

INSERT INTO "permissions" ("id", "key", "group", "description")
VALUES (gen_random_uuid(), 'PROJECT_MANAGE_ALL', 'Projects', 'Manage every project, not only those they lead, created, are on or whose branch they manage')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" = 'PROJECT_MANAGE_ALL'
WHERE r."isSystem" AND r."key" IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p
WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id" AND r."isSystem"
  AND ((r."key" = 'ADMIN' AND p."key" = 'PROJECT_DELETE') OR (r."key" = 'MANAGER' AND p."key" = 'TASK_DELETE'));
