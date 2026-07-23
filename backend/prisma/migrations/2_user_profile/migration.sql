-- Add editable account profile fields without changing existing users.
ALTER TABLE "User"
  ADD COLUMN "phoneNumber" TEXT,
  ADD COLUMN "avatarUrl" TEXT;
