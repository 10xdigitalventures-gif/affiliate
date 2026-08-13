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
