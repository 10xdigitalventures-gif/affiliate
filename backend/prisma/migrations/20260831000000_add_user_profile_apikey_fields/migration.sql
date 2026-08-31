-- Add phoneNumber and avatarUrl to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl"   TEXT;

-- Add prefix and expiresAt to ApiKey table
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "prefix"    TEXT;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ;
