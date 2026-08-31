-- =============================================================================
-- FORCE ROW LEVEL SECURITY - run this ONCE against production / Supabase
-- Usage:  psql $DATABASE_URL -f scripts/apply-force-rls.sql
-- =============================================================================

-- Helper: read the current tenant from the session variable.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
  $$;

-- Tables with a direct organizationId column
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
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS bypass    ON %I', t);
    EXECUTE format(
      $p$CREATE POLICY bypass ON %I AS PERMISSIVE FOR ALL TO PUBLIC
         USING (current_setting('app.bypass_rls', true) = 'on')$p$, t);
    EXECUTE format(
      $p$CREATE POLICY tenant_rw ON %I AS PERMISSIVE FOR ALL TO PUBLIC
         USING ("organizationId"::uuid = public.current_org_id())$p$, t);
  END LOOP;
END $$;

-- Organization table
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass    ON "Organization";
DROP POLICY IF EXISTS tenant_rw ON "Organization";
CREATE POLICY bypass    ON "Organization" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Organization" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (id::uuid = public.current_org_id());

-- Order (scoped through Store)
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass ON "Order"; DROP POLICY IF EXISTS tenant_rw ON "Order";
CREATE POLICY bypass    ON "Order" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Order" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Store" s
    WHERE s.id::uuid = "Order"."storeId"::uuid
      AND s."organizationId"::uuid = public.current_org_id()));

-- OrderItem
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass ON "OrderItem"; DROP POLICY IF EXISTS tenant_rw ON "OrderItem";
CREATE POLICY bypass    ON "OrderItem" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "OrderItem" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Order" o JOIN "Store" s ON s.id::uuid = o."storeId"::uuid
    WHERE o.id::uuid = "OrderItem"."orderId"::uuid
      AND s."organizationId"::uuid = public.current_org_id()));

-- Commission (scoped through Affiliate)
ALTER TABLE "Commission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass ON "Commission"; DROP POLICY IF EXISTS tenant_rw ON "Commission";
CREATE POLICY bypass    ON "Commission" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY tenant_rw ON "Commission" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM "Affiliate" a
    WHERE a.id::uuid = "Commission"."affiliateId"::uuid
      AND a."organizationId"::uuid = public.current_org_id()));

-- Global tables
ALTER TABLE "Permission"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GatewayEvent"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "Plan"           FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON "Permission";
DROP POLICY IF EXISTS allow_all ON "RolePermission";
DROP POLICY IF EXISTS allow_all ON "GatewayEvent";
DROP POLICY IF EXISTS allow_all ON "Plan";

CREATE POLICY allow_all ON "Permission"     AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY allow_all ON "RolePermission" AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY allow_all ON "GatewayEvent"   AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY allow_all ON "Plan"           AS PERMISSIVE FOR ALL TO PUBLIC USING (true);

RAISE NOTICE 'FORCE RLS policies applied successfully.';
