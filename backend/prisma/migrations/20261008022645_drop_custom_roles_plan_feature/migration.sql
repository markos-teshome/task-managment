-- Creating custom roles is an Owner capability on every plan (assessment §04), not a paid feature.
-- Remove the obsolete CUSTOM_ROLES flag from existing plan rows. No other data changes.
UPDATE "subscription_plans" SET "features" = array_remove("features", 'CUSTOM_ROLES'), "updatedAt" = NOW()
WHERE 'CUSTOM_ROLES' = ANY("features");
