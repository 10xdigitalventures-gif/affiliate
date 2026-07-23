-- Add v7.2 operational-limit defaults to the built-in plans without
-- overwriting any limits already customized by the platform owner.
BEGIN;

UPDATE "Plan"
SET "limits" = CASE "key"
  WHEN 'starter' THEN '{"trackingLinksPerAffiliate":10,"monthlyPayoutRequestsPerAffiliate":2}'::jsonb
  WHEN 'growth' THEN '{"trackingLinksPerAffiliate":250,"monthlyPayoutRequestsPerAffiliate":10}'::jsonb
  WHEN 'enterprise' THEN '{"trackingLinksPerAffiliate":-1,"monthlyPayoutRequestsPerAffiliate":-1}'::jsonb
  ELSE '{"trackingLinksPerAffiliate":5,"monthlyPayoutRequestsPerAffiliate":1}'::jsonb
END || COALESCE("limits", '{}'::jsonb);

COMMIT;
