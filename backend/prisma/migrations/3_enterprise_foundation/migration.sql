-- Enterprise v6 foundation
--
-- This migration is intentionally additive. Existing v5 commissions and
-- balances are backfilled before NOT NULL/unique constraints are enabled.

-- Prisma does not add a PostgreSQL transaction around migration files by
-- default. Keep this enterprise upgrade atomic so any unexpected legacy-data
-- conflict rolls the whole migration back instead of leaving a P3018 partial
-- schema that needs manual repair.
BEGIN;

CREATE TYPE "LedgerEntryType" AS ENUM (
  'commission_payable',
  'commission_adjustment',
  'payout_reserved',
  'payout_released',
  'payout_paid',
  'reconciliation'
);

-- Webhook deliveries are claimed before processing. The lease timestamp lets
-- a later delivery safely recover work abandoned by a crashed worker.
ALTER TYPE "WebhookStatus" ADD VALUE IF NOT EXISTS 'processing';

ALTER TABLE "WebhookEvent" ADD COLUMN "processingStartedAt" TIMESTAMP(3);

-- At most one active/approved application per tenant/email. Prefer an existing
-- approval over a pending duplicate before the partial uniqueness rule lands.
WITH ranked_applications AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", LOWER(BTRIM("email"))
      ORDER BY CASE WHEN "status" = 'approved' THEN 0 ELSE 1 END, "createdAt", "id"
    ) AS position
  FROM "AffiliateApplication"
  WHERE "status" IN ('pending', 'approved')
)
UPDATE "AffiliateApplication" AS application
SET "status" = 'rejected'
FROM ranked_applications
WHERE application."id" = ranked_applications."id"
  AND ranked_applications.position > 1;

CREATE UNIQUE INDEX "AffiliateApplication_active_email_key"
  ON "AffiliateApplication" ("organizationId", LOWER(BTRIM("email")))
  WHERE "status" IN ('pending', 'approved');

-- Provider retries previously could enqueue the same order for fraud review
-- more than once. Keep the first review and enforce one review per attribution.
WITH ranked_fraud_reviews AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orderId", "affiliateId"
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "FraudReview"
)
DELETE FROM "FraudReview" AS review
USING ranked_fraud_reviews
WHERE review."id" = ranked_fraud_reviews."id"
  AND ranked_fraud_reviews.position > 1;

DROP INDEX IF EXISTS "FraudReview_orderId_idx";
CREATE UNIQUE INDEX "FraudReview_orderId_affiliateId_key"
  ON "FraudReview"("orderId", "affiliateId");

-- Coupon attribution must be deterministic. Repoint orders from duplicate
-- legacy coupons to the oldest canonical record, remove the duplicates, and
-- normalize codes before enforcing one code per store at database level.
WITH ranked_coupons AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "storeId", UPPER(BTRIM("code"))
      ORDER BY "createdAt", "id"
    ) AS canonical_id,
    ROW_NUMBER() OVER (
      PARTITION BY "storeId", UPPER(BTRIM("code"))
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "Coupon"
)
UPDATE "Order" AS customer_order
SET "couponId" = ranked_coupons.canonical_id
FROM ranked_coupons
WHERE customer_order."couponId" = ranked_coupons."id"
  AND ranked_coupons.position > 1;

WITH ranked_coupons AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "storeId", UPPER(BTRIM("code"))
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "Coupon"
)
DELETE FROM "Coupon" AS coupon
USING ranked_coupons
WHERE coupon."id" = ranked_coupons."id"
  AND ranked_coupons.position > 1;

UPDATE "Coupon" SET "code" = UPPER(BTRIM("code"));
CREATE UNIQUE INDEX "Coupon_storeId_code_key" ON "Coupon"("storeId", "code");

-- Legacy link/click rows had un-enforced store identifiers. Detach invalid or
-- cross-tenant references before adding real foreign keys and tenant triggers.
UPDATE "AffiliateLink" AS link
SET "storeId" = NULL
WHERE link."storeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Store" store
    JOIN "Affiliate" affiliate ON affiliate."id" = link."affiliateId"
    WHERE store."id" = link."storeId"
      AND store."organizationId" = affiliate."organizationId"
  );

UPDATE "AffiliateLink" AS link
SET "campaignId" = NULL
WHERE link."campaignId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Campaign" campaign
    JOIN "Affiliate" affiliate ON affiliate."id" = link."affiliateId"
    WHERE campaign."id" = link."campaignId"
      AND campaign."organizationId" = affiliate."organizationId"
  );

UPDATE "Click" AS click
SET "storeId" = NULL
WHERE click."storeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Store" store
    JOIN "Affiliate" affiliate ON affiliate."id" = click."affiliateId"
    WHERE store."id" = click."storeId"
      AND store."organizationId" = affiliate."organizationId"
  );

ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "ssoSubject" TEXT;

ALTER TABLE "Customer"
  ADD COLUMN "externalCustomerId" TEXT,
  ADD COLUMN "normalizedEmail" TEXT;

ALTER TABLE "Commission"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "payableAt" TIMESTAMP(3);

ALTER TABLE "CommissionAdjustment"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "Subscription"
  ADD COLUMN "billingLockAt" TIMESTAMP(3),
  ADD COLUMN "billingLockToken" TEXT,
  ADD COLUMN "pastDueSince" TIMESTAMP(3);

ALTER TABLE "BillingInvoice"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE TABLE "SsoLoginState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "codeVerifier" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "redirectPath" TEXT NOT NULL DEFAULT '/',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoLoginState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoginExchangeCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginExchangeCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopifyOAuthState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopifyStaffIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shopifyUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyStaffIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateLedgerEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "commissionId" TEXT,
  "payoutId" TEXT,
  "type" "LedgerEntryType" NOT NULL,
  "balanceDelta" DECIMAL(14,4) NOT NULL,
  "lifetimeDelta" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateBalance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "available" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "lifetime" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateBalance_pkey" PRIMARY KEY ("id")
);

-- Preserve every legacy commission and give it a stable unique key before
-- making the field mandatory for all future writes.
UPDATE "Commission"
SET "idempotencyKey" = 'legacy-commission:' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "Commission" ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "BillingInvoice_idempotencyKey_key"
  ON "BillingInvoice"("idempotencyKey");
CREATE INDEX "BillingInvoice_organizationId_periodStart_idx"
  ON "BillingInvoice"("organizationId", "periodStart");

-- Normalize one canonical customer email per tenant. Historical duplicate
-- customer records remain addressable by old orders, while only the oldest
-- receives the new unique normalized identity.
WITH ranked AS (
  SELECT
    "id",
    LOWER(BTRIM("email")) AS normalized,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", LOWER(BTRIM("email"))
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "Customer"
  WHERE "email" IS NOT NULL AND BTRIM("email") <> ''
)
UPDATE "Customer" AS customer
SET "normalizedEmail" = CASE WHEN ranked.position = 1 THEN ranked.normalized ELSE NULL END
FROM ranked
WHERE customer."id" = ranked."id";

-- Older builds could create repeated attribution rows for the same order and
-- affiliate. Keep the first record so the new idempotency constraint is safe.
WITH duplicates AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orderId", "affiliateId"
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "Conversion"
)
DELETE FROM "Conversion" AS conversion
USING duplicates
WHERE conversion."id" = duplicates."id" AND duplicates.position > 1;

-- Convert legacy single-currency cached totals into the v6 currency-specific
-- cache and record an immutable opening reconciliation entry.
INSERT INTO "AffiliateBalance" (
  "id", "organizationId", "affiliateId", "currency", "available", "lifetime", "updatedAt"
)
SELECT
  'balance:' || affiliate."id" || ':' || organization."defaultCurrency",
  affiliate."organizationId",
  affiliate."id",
  organization."defaultCurrency",
  affiliate."availableBalance",
  affiliate."lifetimeEarnings",
  CURRENT_TIMESTAMP
FROM "Affiliate" AS affiliate
JOIN "Organization" AS organization ON organization."id" = affiliate."organizationId";

INSERT INTO "AffiliateLedgerEntry" (
  "id", "organizationId", "affiliateId", "type", "balanceDelta", "lifetimeDelta",
  "currency", "idempotencyKey", "description", "metadata", "createdAt"
)
SELECT
  'opening-ledger:' || affiliate."id" || ':' || organization."defaultCurrency",
  affiliate."organizationId",
  affiliate."id",
  'reconciliation'::"LedgerEntryType",
  affiliate."availableBalance",
  affiliate."lifetimeEarnings",
  organization."defaultCurrency",
  'migration-opening:' || affiliate."id" || ':' || organization."defaultCurrency",
  'Opening balance imported during enterprise v6 migration',
  jsonb_build_object('migration', '3_enterprise_foundation'),
  CURRENT_TIMESTAMP
FROM "Affiliate" AS affiliate
JOIN "Organization" AS organization ON organization."id" = affiliate."organizationId";

CREATE UNIQUE INDEX "SsoLoginState_stateHash_key" ON "SsoLoginState"("stateHash");
CREATE INDEX "SsoLoginState_organizationId_expiresAt_idx" ON "SsoLoginState"("organizationId", "expiresAt");
CREATE UNIQUE INDEX "LoginExchangeCode_codeHash_key" ON "LoginExchangeCode"("codeHash");
CREATE INDEX "LoginExchangeCode_userId_expiresAt_idx" ON "LoginExchangeCode"("userId", "expiresAt");
CREATE UNIQUE INDEX "ShopifyOAuthState_stateHash_key" ON "ShopifyOAuthState"("stateHash");
CREATE INDEX "ShopifyOAuthState_organizationId_expiresAt_idx" ON "ShopifyOAuthState"("organizationId", "expiresAt");
CREATE INDEX "ShopifyStaffIdentity_organizationId_idx" ON "ShopifyStaffIdentity"("organizationId");
CREATE UNIQUE INDEX "ShopifyStaffIdentity_storeId_shopifyUserId_key" ON "ShopifyStaffIdentity"("storeId", "shopifyUserId");
CREATE UNIQUE INDEX "ShopifyStaffIdentity_storeId_userId_key" ON "ShopifyStaffIdentity"("storeId", "userId");
CREATE UNIQUE INDEX "AffiliateLedgerEntry_idempotencyKey_key" ON "AffiliateLedgerEntry"("idempotencyKey");
CREATE INDEX "AffiliateLedgerEntry_organizationId_createdAt_idx" ON "AffiliateLedgerEntry"("organizationId", "createdAt");
CREATE INDEX "AffiliateLedgerEntry_affiliateId_currency_createdAt_idx" ON "AffiliateLedgerEntry"("affiliateId", "currency", "createdAt");
CREATE INDEX "AffiliateBalance_organizationId_currency_idx" ON "AffiliateBalance"("organizationId", "currency");
CREATE UNIQUE INDEX "AffiliateBalance_affiliateId_currency_key" ON "AffiliateBalance"("affiliateId", "currency");
CREATE UNIQUE INDEX "User_organizationId_ssoProvider_ssoSubject_key" ON "User"("organizationId", "ssoProvider", "ssoSubject");
CREATE UNIQUE INDEX "Customer_organizationId_normalizedEmail_key" ON "Customer"("organizationId", "normalizedEmail");
CREATE UNIQUE INDEX "Customer_organizationId_externalCustomerId_key" ON "Customer"("organizationId", "externalCustomerId");
CREATE UNIQUE INDEX "Conversion_orderId_affiliateId_key" ON "Conversion"("orderId", "affiliateId");
CREATE UNIQUE INDEX "Commission_idempotencyKey_key" ON "Commission"("idempotencyKey");
CREATE UNIQUE INDEX "CommissionAdjustment_idempotencyKey_key" ON "CommissionAdjustment"("idempotencyKey");

ALTER TABLE "SsoLoginState" ADD CONSTRAINT "SsoLoginState_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginExchangeCode" ADD CONSTRAINT "LoginExchangeCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyOAuthState" ADD CONSTRAINT "ShopifyOAuthState_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyStaffIdentity" ADD CONSTRAINT "ShopifyStaffIdentity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyStaffIdentity" ADD CONSTRAINT "ShopifyStaffIdentity_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyStaffIdentity" ADD CONSTRAINT "ShopifyStaffIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateLedgerEntry" ADD CONSTRAINT "AffiliateLedgerEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateLedgerEntry" ADD CONSTRAINT "AffiliateLedgerEntry_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateLedgerEntry" ADD CONSTRAINT "AffiliateLedgerEntry_commissionId_fkey"
  FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateLedgerEntry" ADD CONSTRAINT "AffiliateLedgerEntry_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateBalance" ADD CONSTRAINT "AffiliateBalance_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateBalance" ADD CONSTRAINT "AffiliateBalance_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase public-schema hardening for new tables. Prisma's database owner
-- remains able to access them; anonymous Data API roles receive no grants.
ALTER TABLE "SsoLoginState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginExchangeCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopifyOAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopifyStaffIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateBalance" ENABLE ROW LEVEL SECURITY;

-- Supabase creates anon/authenticated roles, while a normal PostgreSQL server
-- does not. Revoke only roles that exist so the same release migration remains
-- portable to the final self-hosted server.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "SsoLoginState", "LoginExchangeCode", "ShopifyOAuthState", '
      '"ShopifyStaffIdentity", "AffiliateLedgerEntry", "AffiliateBalance" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "SsoLoginState", "LoginExchangeCode", "ShopifyOAuthState", '
      '"ShopifyStaffIdentity", "AffiliateLedgerEntry", "AffiliateBalance" FROM authenticated';
  END IF;
END;
$$;

-- Ledger and audit history is append-only at database level.
CREATE OR REPLACE FUNCTION app_prevent_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; create a compensating record instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AffiliateLedgerEntry_immutable"
BEFORE UPDATE OR DELETE ON "AffiliateLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION app_prevent_immutable_mutation();

CREATE TRIGGER "AuditLog_immutable"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION app_prevent_immutable_mutation();

-- Relational foreign keys prove that referenced rows exist, but ordinary FKs
-- do not prove they belong to the same tenant. These triggers close that gap
-- for every high-risk identity, order and money relationship.
CREATE OR REPLACE FUNCTION app_assert_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_org TEXT;
  related_org TEXT;
  related_affiliate TEXT;
BEGIN
  IF TG_TABLE_NAME = 'UserRole' THEN
    SELECT "organizationId" INTO expected_org FROM "User" WHERE "id" = NEW."userId";
    SELECT "organizationId" INTO related_org FROM "Role" WHERE "id" = NEW."roleId";
    IF related_org IS NOT NULL AND related_org IS DISTINCT FROM expected_org THEN
      RAISE EXCEPTION 'UserRole tenant mismatch' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'Affiliate' THEN
    IF NEW."userId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "User" WHERE "id" = NEW."userId";
      IF related_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Affiliate user tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."parentAffiliateId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."parentAffiliateId";
      IF related_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Affiliate parent tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'AffiliateLink' THEN
    SELECT "organizationId" INTO expected_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF NEW."storeId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Store" WHERE "id" = NEW."storeId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'AffiliateLink store tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."campaignId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Campaign" WHERE "id" = NEW."campaignId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'AffiliateLink campaign tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Click' THEN
    SELECT "organizationId" INTO expected_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF NEW."affiliateLinkId" IS NOT NULL THEN
      SELECT affiliate."organizationId" INTO related_org
      FROM "AffiliateLink" link
      JOIN "Affiliate" affiliate ON affiliate."id" = link."affiliateId"
      WHERE link."id" = NEW."affiliateLinkId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Click link tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."storeId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Store" WHERE "id" = NEW."storeId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Click store tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Conversion' THEN
    SELECT "organizationId" INTO expected_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    SELECT store."organizationId" INTO related_org
    FROM "Order" orders JOIN "Store" store ON store."id" = orders."storeId"
    WHERE orders."id" = NEW."orderId";
    IF related_org IS DISTINCT FROM expected_org THEN
      RAISE EXCEPTION 'Conversion order tenant mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW."clickId" IS NOT NULL THEN
      SELECT affiliate."organizationId" INTO related_org
      FROM "Click" click JOIN "Affiliate" affiliate ON affiliate."id" = click."affiliateId"
      WHERE click."id" = NEW."clickId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Conversion click tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'FraudReview' THEN
    SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'FraudReview affiliate tenant mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT store."organizationId" INTO related_org
    FROM "Order" orders JOIN "Store" store ON store."id" = orders."storeId"
    WHERE orders."id" = NEW."orderId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'FraudReview order tenant mismatch' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'CommissionRule' THEN
    IF NEW."scope" = 'global' AND NEW."scopeRefId" IS NOT NULL THEN
      RAISE EXCEPTION 'Global CommissionRule cannot have scopeRefId' USING ERRCODE = '23514';
    ELSIF NEW."scope" <> 'global' AND NEW."scopeRefId" IS NULL THEN
      RAISE EXCEPTION 'Scoped CommissionRule requires scopeRefId' USING ERRCODE = '23514';
    ELSIF NEW."scope" = 'store' THEN
      SELECT "organizationId" INTO related_org FROM "Store" WHERE "id" = NEW."scopeRefId";
    ELSIF NEW."scope" = 'category' THEN
      SELECT "organizationId" INTO related_org FROM "Category" WHERE "id" = NEW."scopeRefId";
    ELSIF NEW."scope" = 'product' THEN
      SELECT store."organizationId" INTO related_org
      FROM "Product" product JOIN "Store" store ON store."id" = product."storeId"
      WHERE product."id" = NEW."scopeRefId";
    ELSIF NEW."scope" = 'campaign' THEN
      SELECT "organizationId" INTO related_org FROM "Campaign" WHERE "id" = NEW."scopeRefId";
    ELSIF NEW."scope" = 'affiliate' THEN
      SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."scopeRefId";
    END IF;
    IF NEW."scope" <> 'global' AND related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'CommissionRule scope tenant mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'Coupon' THEN
    SELECT "organizationId" INTO expected_org FROM "Store" WHERE "id" = NEW."storeId";
    IF NEW."affiliateId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Coupon affiliate tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Product' THEN
    SELECT "organizationId" INTO expected_org FROM "Store" WHERE "id" = NEW."storeId";
    IF NEW."categoryId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Category" WHERE "id" = NEW."categoryId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Product category tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Order' THEN
    SELECT "organizationId" INTO expected_org FROM "Store" WHERE "id" = NEW."storeId";
    IF NEW."customerId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Customer" WHERE "id" = NEW."customerId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Order customer tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."affiliateId" IS NOT NULL THEN
      SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Order affiliate tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."couponId" IS NOT NULL THEN
      SELECT store."organizationId" INTO related_org
      FROM "Coupon" coupon JOIN "Store" store ON store."id" = coupon."storeId"
      WHERE coupon."id" = NEW."couponId";
      IF related_org IS DISTINCT FROM expected_org THEN
        RAISE EXCEPTION 'Order coupon tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Commission' THEN
    SELECT "organizationId" INTO expected_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    SELECT store."organizationId" INTO related_org
    FROM "Order" orders JOIN "Store" store ON store."id" = orders."storeId"
    WHERE orders."id" = NEW."orderId";
    IF related_org IS DISTINCT FROM expected_org THEN
      RAISE EXCEPTION 'Commission order tenant mismatch' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'Payout' THEN
    SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Payout affiliate tenant mismatch' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'AffiliateBalance' THEN
    SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'AffiliateBalance tenant mismatch' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'AffiliateLedgerEntry' THEN
    SELECT "organizationId" INTO related_org FROM "Affiliate" WHERE "id" = NEW."affiliateId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'AffiliateLedgerEntry affiliate tenant mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW."commissionId" IS NOT NULL THEN
      SELECT affiliate."organizationId", commission."affiliateId"
      INTO related_org, related_affiliate
      FROM "Commission" commission
      JOIN "Affiliate" affiliate ON affiliate."id" = commission."affiliateId"
      WHERE commission."id" = NEW."commissionId";
      IF related_org IS DISTINCT FROM NEW."organizationId" OR related_affiliate IS DISTINCT FROM NEW."affiliateId" THEN
        RAISE EXCEPTION 'AffiliateLedgerEntry commission tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."payoutId" IS NOT NULL THEN
      SELECT "organizationId", "affiliateId" INTO related_org, related_affiliate
      FROM "Payout" WHERE "id" = NEW."payoutId";
      IF related_org IS DISTINCT FROM NEW."organizationId" OR related_affiliate IS DISTINCT FROM NEW."affiliateId" THEN
        RAISE EXCEPTION 'AffiliateLedgerEntry payout tenant mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'ShopifyStaffIdentity' THEN
    SELECT "organizationId" INTO related_org FROM "Store" WHERE "id" = NEW."storeId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'ShopifyStaffIdentity store tenant mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT "organizationId" INTO related_org FROM "User" WHERE "id" = NEW."userId";
    IF related_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'ShopifyStaffIdentity user tenant mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserRole_tenant_consistency" BEFORE INSERT OR UPDATE ON "UserRole"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Affiliate_tenant_consistency" BEFORE INSERT OR UPDATE ON "Affiliate"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "AffiliateLink_tenant_consistency" BEFORE INSERT OR UPDATE ON "AffiliateLink"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Click_tenant_consistency" BEFORE INSERT OR UPDATE ON "Click"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Conversion_tenant_consistency" BEFORE INSERT OR UPDATE ON "Conversion"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "FraudReview_tenant_consistency" BEFORE INSERT OR UPDATE ON "FraudReview"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "CommissionRule_tenant_consistency" BEFORE INSERT OR UPDATE ON "CommissionRule"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Coupon_tenant_consistency" BEFORE INSERT OR UPDATE ON "Coupon"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Product_tenant_consistency" BEFORE INSERT OR UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Order_tenant_consistency" BEFORE INSERT OR UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Commission_tenant_consistency" BEFORE INSERT OR UPDATE ON "Commission"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "Payout_tenant_consistency" BEFORE INSERT OR UPDATE ON "Payout"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "AffiliateBalance_tenant_consistency" BEFORE INSERT OR UPDATE ON "AffiliateBalance"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "AffiliateLedgerEntry_tenant_consistency" BEFORE INSERT ON "AffiliateLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();
CREATE TRIGGER "ShopifyStaffIdentity_tenant_consistency" BEFORE INSERT OR UPDATE ON "ShopifyStaffIdentity"
FOR EACH ROW EXECUTE FUNCTION app_assert_tenant_consistency();

COMMIT;
