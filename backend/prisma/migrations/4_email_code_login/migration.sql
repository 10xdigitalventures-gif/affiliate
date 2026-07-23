-- Secure passwordless email-code login.
BEGIN;

CREATE TABLE "EmailLoginCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailLoginCode_challengeHash_key" ON "EmailLoginCode"("challengeHash");
CREATE INDEX "EmailLoginCode_userId_idx" ON "EmailLoginCode"("userId");
CREATE INDEX "EmailLoginCode_expiresAt_idx" ON "EmailLoginCode"("expiresAt");

ALTER TABLE "EmailLoginCode"
  ADD CONSTRAINT "EmailLoginCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
