-- Add editable account profile fields without changing existing users.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
