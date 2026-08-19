-- =============================================================================
-- FORCE ROW LEVEL SECURITY - tenant isolation at the database layer
-- =============================================================================
-- WHY:
--   The previous RLS migration enabled RLS but left FORCE RLS off, so the
--   Prisma user (postgres / table owner) still bypassed all policies. This
--   migration adds FORCE ROW LEVEL SECURITY on every tenant-scoped table so
--   even the connection role is bound by the policies.
--
-- HOW IT WORKS AT RUNTIME:
--   1. Before each tenant query, the application calls:
--        SET LOCAL app.current_org_id = '<uuid>';
--      (or SET SESSION for long-lived connections outside a transaction).
--   2. The current_org_id() function reads that variable and the policy
--      restricts the query to that one organization's rows.
--   3. Internal / superadmin paths call:
--        SET LOCAL app.bypass_rls = 'on';
--      which triggers the BYPASS policy instead.
--
-- PRODUCTION SETUP (run scripts/create-api-role.sql separately):
--   Create a low-privilege `affiliate_api` role and connect Prisma with it
--   so Prisma itself is subject to RLS. The postgres superuser role should
--   only be used for migrations.
-- =============================================================================

-- Helper: read the current tenant from the session variable.
-- Returns NULL if the variable is not set (query will match no rows).
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
  $$;

-- =============================================================================
-- Tables with a direct organizationId column
-- =============================================================================
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Role','UserRole','RefreshToken','PasswordResetToken','Invitation',
    'Affiliate','AffiliateApplication','AffiliateLink',
    'Store','StoreCredential','ApiKey','AuditLog','Setting',
    'Subscription','Domain','PaymentGatewayConfig',
    'BillingCustomer','BillingInvoice',
    'Category','Product','ProductMapping','Coupon','Customer',
    'Click','Conversion','CommissionRule','CommissionAdjustment',
    'Payout','PayoutItem','PayoutMethodRecord',
    'Campaign','MarketingAsset','Notification','WebhookEvent','SyncJob',
    'FraudReview'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- Drop old policies so this migration is re-runnable.
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS bypass    ON %I', t);

    -- Bypass policy: internal/superadmin paths set app.bypass_rls=on.
    EXECUTE format(
      'CREATE POLICY bypass ON %I AS PERMISSIVE FOR ALL TO PUBLIC
         USING (current_setting(''app.bypass_rls'', true) = ''on'')',
      t);

    -- Tenant isolation policy: rows must belong to the current org.
    EXECUTE format(
      'CREATE POLICY tenant_rw ON %I AS PERMISSIVE FOR ALL TO PUBLIC
         USING ("organizationId" = public.current_org_id())',
      t);
  END LOOP;
END $$;

-- =============================================================================
-- Organization table (scoped on id, not organizationId)
-- =============================================================================
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass    ON "Organization";
DROP POLICY IF EXISTS tenant_rw ON "Organization";
CREATE POLICY bypass ON "Organization" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Organization" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (id = public.current_org_id());

-- =============================================================================
-- Relation-scoped tables (no direct organizationId; scoped through a join)
-- These need individual policies because the org lives on a parent table.
-- =============================================================================

-- Order: scoped through Store
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass    ON "Order";
DROP POLICY IF EXISTS tenant_rw ON "Order";
CREATE POLICY bypass ON "Order" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Order" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Store" s
    WHERE s.id = "Order"."storeId"
      AND s."organizationId" = public.current_org_id()
  ));

-- OrderItem: scoped through Order -> Store
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass    ON "OrderItem";
DROP POLICY IF EXISTS tenant_rw ON "OrderItem";
CREATE POLICY bypass ON "OrderItem" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "OrderItem" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Order" o JOIN "Store" s ON s.id = o."storeId"
    WHERE o.id = "OrderItem"."orderId"
      AND s."organizationId" = public.current_org_id()
  ));

-- Commission: scoped through Affiliate
ALTER TABLE "Commission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass    ON "Commission";
DROP POLICY IF EXISTS tenant_rw ON "Commission";
CREATE POLICY bypass ON "Commission" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Commission" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Affiliate" a
    WHERE a.id = "Commission"."affiliateId"
      AND a."organizationId" = public.current_org_id()
  ));

-- =============================================================================
-- Global / shared reference tables - no tenant restriction
-- =============================================================================
ALTER TABLE "Permission"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GatewayEvent"  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON "Permission";
DROP POLICY IF EXISTS allow_all ON "RolePermission";
DROP POLICY IF EXISTS allow_all ON "GatewayEvent";

CREATE POLICY allow_all ON "Permission"    AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY allow_all ON "RolePermission" AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY allow_all ON "GatewayEvent"  AS PERMISSIVE FOR ALL TO PUBLIC USING (true);

-- Plan is global reference data (visible to all tenants for plan selection)
ALTER TABLE "Plan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON "Plan";
CREATE POLICY allow_all ON "Plan" AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
