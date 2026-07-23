-- ============================================================
-- FULL INIT SCHEMA (generated from schema.prisma)
-- Unified Affiliate Management Platform
-- Run in Supabase SQL Editor to recreate all tables.
-- ============================================================

-- ---------- ENUM TYPES ----------
CREATE TYPE "OrgStatus" AS ENUM ('active', 'suspended', 'trial');
CREATE TYPE "UserStatus" AS ENUM ('active', 'invited', 'suspended');
CREATE TYPE "Platform" AS ENUM ('shopify', 'woocommerce', 'ghl', 'custom');
CREATE TYPE "StoreStatus" AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE "AffiliateStatus" AS ENUM ('pending', 'approved', 'suspended', 'rejected');
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "CouponStatus" AS ENUM ('active', 'expired', 'disabled');
CREATE TYPE "DiscountType" AS ENUM ('percentage', 'fixed');
CREATE TYPE "ProductStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "RuleScope" AS ENUM ('global', 'store', 'category', 'product', 'campaign', 'affiliate');
CREATE TYPE "CommissionType" AS ENUM ('percentage', 'fixed', 'tiered', 'recurring');
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'approved', 'locked', 'payable', 'paid', 'cancelled', 'reversed');
CREATE TYPE "AdjustmentType" AS ENUM ('reversal', 'manual', 'bonus', 'penalty', 'partial_refund');
CREATE TYPE "PayoutMethod" AS ENUM ('bank', 'wise', 'paypal', 'stripe', 'manual', 'crypto');
CREATE TYPE "PayoutStatus" AS ENUM ('requested', 'approved', 'processing', 'paid', 'failed', 'rejected');
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'ended');
CREATE TYPE "AttributionMethod" AS ENUM ('coupon', 'cookie', 'lifetime', 'manual');
CREATE TYPE "WebhookStatus" AS ENUM ('received', 'processed', 'failed');
CREATE TYPE "SyncJobStatus" AS ENUM ('queued', 'running', 'success', 'failed');
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'in_app', 'webhook');
CREATE TYPE "FraudDecision" AS ENUM ('allow', 'review', 'block');
CREATE TYPE "FraudReviewStatus" AS ENUM ('open', 'approved', 'rejected');
CREATE TYPE "PlanInterval" AS ENUM ('month', 'year');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled');
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'verifying', 'active', 'failed');
CREATE TYPE "DomainPurpose" AS ENUM ('login', 'tracking');
CREATE TYPE "GatewayProvider" AS ENUM ('whop', 'swich');
CREATE TYPE "GatewayScope" AS ENUM ('platform', 'tenant');
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible', 'refunded');
CREATE TYPE "BillingEventStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "plan" TEXT NOT NULL DEFAULT 'trial',
  "status" "OrgStatus" NOT NULL DEFAULT 'trial'::"OrgStatus",
  "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'USD',
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "fullName" TEXT,
  "status" "UserStatus" NOT NULL DEFAULT 'invited'::"UserStatus",
  "emailVerifiedAt" TIMESTAMP(3),
  "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  "twoFactorSecret" TEXT,
  "twoFactorRecoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ssoProvider" TEXT,
  "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "name" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

CREATE TABLE "UserRole" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "roleId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "invitedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Store" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "status" "StoreStatus" NOT NULL DEFAULT 'disconnected'::"StoreStatus",
  "webhookStatus" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreCredential" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "accessTokenEnc" BYTEA,
  "consumerKeyEnc" BYTEA,
  "consumerSecretEnc" BYTEA,
  "webhookSecretEnc" BYTEA,
  "scopes" TEXT[] NOT NULL,
  "rotatedAt" TIMESTAMP(3),
  CONSTRAINT "StoreCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Affiliate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "affiliateCode" TEXT NOT NULL,
  "referralSlug" TEXT NOT NULL,
  "status" "AffiliateStatus" NOT NULL DEFAULT 'pending'::"AffiliateStatus",
  "defaultCommissionRuleId" TEXT,
  "parentAffiliateId" TEXT,
  "lifetimeEarnings" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "availableBalance" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxInfo" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateApplication" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "payload" JSONB,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'pending'::"ApplicationStatus",
  "reviewedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateLink" (
  "id" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "storeId" TEXT,
  "campaignId" TEXT,
  "destinationUrl" TEXT NOT NULL,
  "shortCode" TEXT NOT NULL,
  "clicksCount" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalId" TEXT,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "categoryId" TEXT,
  "price" DECIMAL(14,4) NOT NULL,
  "status" "ProductStatus" NOT NULL DEFAULT 'active'::"ProductStatus",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "productIds" TEXT[] NOT NULL,
  CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "affiliateId" TEXT,
  "code" TEXT NOT NULL,
  "externalId" TEXT,
  "discountType" "DiscountType",
  "status" "CouponStatus" NOT NULL DEFAULT 'active'::"CouponStatus",
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "firstAffiliateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "customerId" TEXT,
  "affiliateId" TEXT,
  "couponId" TEXT,
  "currency" CHAR(3) NOT NULL,
  "subtotal" DECIMAL(14,4) NOT NULL,
  "tax" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "shipping" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,4) NOT NULL,
  "refundAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "attributionType" TEXT,
  "trafficChannel" TEXT,
  "adNetwork" TEXT,
  "adClickId" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "landingPage" TEXT,
  "referrer" TEXT,
  "placedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "decision" "FraudDecision" NOT NULL,
  "status" "FraudReviewStatus" NOT NULL DEFAULT 'open'::"FraudReviewStatus",
  "reasons" JSONB NOT NULL,
  "signals" JSONB,
  "notes" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FraudReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(14,4) NOT NULL,
  "commissionAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Click" (
  "id" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "affiliateLinkId" TEXT,
  "storeId" TEXT,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "deviceType" TEXT,
  "landingPage" TEXT,
  "utm" JSONB,
  "channel" TEXT,
  "adNetwork" TEXT,
  "country" CHAR(2),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversion" (
  "id" TEXT NOT NULL,
  "clickId" TEXT,
  "orderId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "attributionMethod" "AttributionMethod" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" "RuleScope" NOT NULL,
  "scopeRefId" TEXT,
  "type" "CommissionType" NOT NULL,
  "value" DECIMAL(14,4) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "stackable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "commissionRuleId" TEXT,
  "amount" DECIMAL(14,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "channel" TEXT,
  "attributionType" TEXT,
  "status" "CommissionStatus" NOT NULL DEFAULT 'pending'::"CommissionStatus",
  "payoutItemId" TEXT,
  "tier" INTEGER NOT NULL DEFAULT 0,
  "sourceCommissionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionAdjustment" (
  "id" TEXT NOT NULL,
  "commissionId" TEXT NOT NULL,
  "type" "AdjustmentType" NOT NULL,
  "delta" DECIMAL(14,4) NOT NULL,
  "reason" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payout" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "amount" DECIMAL(14,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'requested'::"PayoutStatus",
  "transactionReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayoutItem" (
  "id" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "amount" DECIMAL(14,4) NOT NULL,
  CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayoutMethodRecord" (
  "id" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "detailsEnc" BYTEA,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "PayoutMethodRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "status" "CampaignStatus" NOT NULL DEFAULT 'draft'::"CampaignStatus",
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingAsset" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  CONSTRAINT "MarketingAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "type" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'in_app'::"NotificationChannel",
  "title" TEXT NOT NULL,
  "body" TEXT,
  "data" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "topic" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookStatus" NOT NULL DEFAULT 'received'::"WebhookStatus",
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncJob" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "status" "SyncJobStatus" NOT NULL DEFAULT 'queued'::"SyncJobStatus",
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Setting" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "interval" "PlanInterval" NOT NULL DEFAULT 'month'::"PlanInterval",
  "features" JSONB NOT NULL DEFAULT '{}',
  "limits" JSONB NOT NULL DEFAULT '{}',
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "trialDays" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing'::"SubscriptionStatus",
  "currentPeriodEnd" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "seats" INTEGER NOT NULL DEFAULT 0,
  "overrides" JSONB,
  "externalRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Domain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" "DomainStatus" NOT NULL DEFAULT 'pending'::"DomainStatus",
  "purpose" "DomainPurpose" NOT NULL DEFAULT 'login'::"DomainPurpose",
  "verificationToken" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "lastCheckedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentGatewayConfig" (
  "id" TEXT NOT NULL,
  "scope" "GatewayScope" NOT NULL DEFAULT 'platform'::"GatewayScope",
  "organizationId" TEXT,
  "provider" "GatewayProvider" NOT NULL,
  "label" TEXT,
  "companyId" TEXT,
  "apiKeyEnc" BYTEA,
  "webhookSecretEnc" BYTEA,
  "isLive" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
  "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxLabel" TEXT DEFAULT 'Tax',
  "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingCustomer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "provider" "GatewayProvider" NOT NULL,
  "providerCustomerId" TEXT,
  "providerMemberId" TEXT,
  "defaultPaymentMethodId" TEXT,
  "cardBrand" TEXT,
  "cardLast4" TEXT,
  "cardExpMonth" INTEGER,
  "cardExpYear" INTEGER,
  "email" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingInvoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "customerId" TEXT,
  "provider" "GatewayProvider" NOT NULL,
  "providerInvoiceId" TEXT,
  "providerPaymentId" TEXT,
  "number" TEXT,
  "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'draft'::"BillingInvoiceStatus",
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "lineItems" JSONB NOT NULL DEFAULT '[]',
  "hostedUrl" TEXT,
  "pdfUrl" TEXT,
  "dueAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GatewayEvent" (
  "id" TEXT NOT NULL,
  "provider" "GatewayProvider" NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "BillingEventStatus" NOT NULL DEFAULT 'received'::"BillingEventStatus",
  "payload" JSONB NOT NULL,
  "error" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);

-- ---------- INDEXES ----------
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId","email");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId","email");
CREATE INDEX "Store_organizationId_idx" ON "Store"("organizationId");
CREATE UNIQUE INDEX "StoreCredential_storeId_key" ON "StoreCredential"("storeId");
CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");
CREATE UNIQUE INDEX "Affiliate_organizationId_affiliateCode_key" ON "Affiliate"("organizationId","affiliateCode");
CREATE UNIQUE INDEX "Affiliate_organizationId_referralSlug_key" ON "Affiliate"("organizationId","referralSlug");
CREATE INDEX "Affiliate_organizationId_idx" ON "Affiliate"("organizationId");
CREATE INDEX "Affiliate_parentAffiliateId_idx" ON "Affiliate"("parentAffiliateId");
CREATE INDEX "AffiliateApplication_organizationId_status_idx" ON "AffiliateApplication"("organizationId","status");
CREATE UNIQUE INDEX "AffiliateLink_shortCode_key" ON "AffiliateLink"("shortCode");
CREATE INDEX "AffiliateLink_affiliateId_idx" ON "AffiliateLink"("affiliateId");
CREATE UNIQUE INDEX "Product_storeId_externalId_key" ON "Product"("storeId","externalId");
CREATE INDEX "Product_storeId_idx" ON "Product"("storeId");
CREATE INDEX "Coupon_storeId_idx" ON "Coupon"("storeId");
CREATE INDEX "Coupon_affiliateId_idx" ON "Coupon"("affiliateId");
CREATE INDEX "Customer_organizationId_email_idx" ON "Customer"("organizationId","email");
CREATE UNIQUE INDEX "Order_storeId_externalOrderId_key" ON "Order"("storeId","externalOrderId");
CREATE INDEX "Order_affiliateId_idx" ON "Order"("affiliateId");
CREATE INDEX "FraudReview_organizationId_status_idx" ON "FraudReview"("organizationId","status");
CREATE INDEX "FraudReview_orderId_idx" ON "FraudReview"("orderId");
CREATE INDEX "FraudReview_affiliateId_idx" ON "FraudReview"("affiliateId");
CREATE INDEX "Click_affiliateId_occurredAt_idx" ON "Click"("affiliateId","occurredAt");
CREATE INDEX "Conversion_orderId_idx" ON "Conversion"("orderId");
CREATE INDEX "CommissionRule_organizationId_scope_idx" ON "CommissionRule"("organizationId","scope");
CREATE UNIQUE INDEX "Commission_payoutItemId_key" ON "Commission"("payoutItemId");
CREATE INDEX "Commission_affiliateId_status_idx" ON "Commission"("affiliateId","status");
CREATE INDEX "Commission_sourceCommissionId_idx" ON "Commission"("sourceCommissionId");
CREATE INDEX "Payout_organizationId_status_idx" ON "Payout"("organizationId","status");
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");
CREATE INDEX "Notification_recipientUserId_readAt_idx" ON "Notification"("recipientUserId","readAt");
CREATE UNIQUE INDEX "WebhookEvent_idempotencyKey_key" ON "WebhookEvent"("idempotencyKey");
CREATE INDEX "WebhookEvent_storeId_topic_idx" ON "WebhookEvent"("storeId","topic");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId","createdAt");
CREATE UNIQUE INDEX "Setting_organizationId_key_key" ON "Setting"("organizationId","key");
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");
CREATE INDEX "Domain_organizationId_idx" ON "Domain"("organizationId");
CREATE INDEX "PaymentGatewayConfig_scope_provider_idx" ON "PaymentGatewayConfig"("scope","provider");
CREATE INDEX "PaymentGatewayConfig_organizationId_idx" ON "PaymentGatewayConfig"("organizationId");
CREATE UNIQUE INDEX "BillingCustomer_organizationId_configId_key" ON "BillingCustomer"("organizationId","configId");
CREATE INDEX "BillingCustomer_provider_idx" ON "BillingCustomer"("provider");
CREATE INDEX "BillingInvoice_organizationId_idx" ON "BillingInvoice"("organizationId");
CREATE INDEX "BillingInvoice_provider_status_idx" ON "BillingInvoice"("provider","status");
CREATE UNIQUE INDEX "GatewayEvent_provider_eventId_key" ON "GatewayEvent"("provider","eventId");
CREATE INDEX "GatewayEvent_type_idx" ON "GatewayEvent"("type");

-- ---------- FOREIGN KEYS ----------
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Store" ADD CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreCredential" ADD CONSTRAINT "StoreCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_parentAffiliateId_fkey" FOREIGN KEY ("parentAffiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateApplication" ADD CONSTRAINT "AffiliateApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_sourceCommissionId_fkey" FOREIGN KEY ("sourceCommissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutItemId_fkey" FOREIGN KEY ("payoutItemId") REFERENCES "PayoutItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutMethodRecord" ADD CONSTRAINT "PayoutMethodRecord_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAsset" ADD CONSTRAINT "MarketingAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentGatewayConfig" ADD CONSTRAINT "PaymentGatewayConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_configId_fkey" FOREIGN KEY ("configId") REFERENCES "PaymentGatewayConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_configId_fkey" FOREIGN KEY ("configId") REFERENCES "PaymentGatewayConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BillingCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ############################################################
-- ############  SUPABASE RLS HARDENING (optional but recommended)
-- ############################################################

-- =====================================================================
-- Supabase RLS hardening  (safe to apply -- does NOT break Prisma)
-- =====================================================================
-- WHY:
--   Supabase exposes the whole `public` schema through its auto-generated
--   Data API (PostgREST) to the `anon` and `authenticated` roles. Enabling
--   RLS with NO permissive policy = deny-by-default for those roles, so no
--   one can touch your data through the public API. This also clears the
--   "RLS disabled in public" security warnings in the Supabase dashboard.
--
-- DOES THIS BREAK THE BACKEND?  No.
--   Prisma connects as the `postgres` role, which OWNS these tables, and a
--   table owner BYPASSES RLS (we deliberately do NOT use FORCE ROW LEVEL
--   SECURITY here). `service_role` also has BYPASSRLS. So every NestJS /
--   Prisma query keeps working exactly as before.
--
-- For true per-row multi-tenant isolation (optional, only needed if you
--   expose the Data API or want RLS enforced against the backend too) see
--   RLS-tenant-isolation-OPTIONAL.sql shipped alongside this file.
-- =====================================================================

-- 1) Enable RLS on every table -------------------------------------------
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Affiliate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FraudReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Click" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Commission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayoutItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayoutMethodRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Domain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentGatewayConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingCustomer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GatewayEvent" ENABLE ROW LEVEL SECURITY;

-- 2) Strip any direct grants the Data API roles may hold -----------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated;

-- Future objects created in public are locked down too
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated;
