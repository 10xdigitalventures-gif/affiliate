-- =====================================================================
-- OPTIONAL: True multi-tenant Row Level Security (session-variable based)
-- =====================================================================
-- Use this ONLY if you want RLS enforced even against your own backend
-- (defense in depth) or you plan to expose the Supabase Data API.
--
-- HOW IT WORKS:
--   Every org-scoped table is filtered by a per-transaction Postgres
--   setting `app.current_org_id`. Your backend must set it at the start
--   of each request/transaction (see the Prisma snippet at the bottom).
--   FORCE ROW LEVEL SECURITY makes the policy apply to the table owner
--   (postgres) too -- so if you enable this you MUST always set the var,
--   otherwise queries return 0 rows.
--
-- NOTE: with a connection pooler in transaction mode (Supabase :6543),
--   always use set_config(..., true) so the value is transaction-scoped.
-- =====================================================================

ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Organization" ON "Organization"
  USING ("id" = current_setting('app.current_org_id', true));

ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_User" ON "User"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Role" ON "Role"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Invitation" ON "Invitation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Store" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Store" ON "Store"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Affiliate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Affiliate" ON "Affiliate"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AffiliateApplication" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_AffiliateApplication" ON "AffiliateApplication"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Category" ON "Category"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ProductMapping" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ProductMapping" ON "ProductMapping"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Customer" ON "Customer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "FraudReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_FraudReview" ON "FraudReview"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CommissionRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_CommissionRule" ON "CommissionRule"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Payout" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Payout" ON "Payout"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Campaign" ON "Campaign"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Notification" ON "Notification"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ApiKey" ON "ApiKey"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_AuditLog" ON "AuditLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Setting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Setting" ON "Setting"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Subscription" ON "Subscription"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Domain" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_Domain" ON "Domain"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PaymentGatewayConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_PaymentGatewayConfig" ON "PaymentGatewayConfig"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "BillingCustomer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_BillingCustomer" ON "BillingCustomer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "BillingInvoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_BillingInvoice" ON "BillingInvoice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------
-- Prisma wiring (TypeScript): set the org context per transaction
-- ---------------------------------------------------------------------
-- await prisma.$transaction(async (tx) => {
--   await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
--   // ...all tenant queries inside here are auto-filtered by orgId...
-- });
