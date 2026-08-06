-- Persist the deterministic Apple fact-ordering tuples the commerce reducers
-- compare against, so equal-time authority and corrective-event precedence
-- survive process restarts and replays.

ALTER TABLE "IapTransaction"
  ADD COLUMN "revocationFactAt" TIMESTAMPTZ(3),
  ADD COLUMN "revocationFactRank" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revocationFactType" VARCHAR(32),
  ADD COLUMN "revocationFactId" VARCHAR(128);

ALTER TABLE "PackCreditGrant"
  ADD COLUMN "greatestRefundSourceRank" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SubscriptionEntitlement"
  ADD COLUMN "billingRetry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "renewalAppliedAt" TIMESTAMPTZ(3),
  ADD COLUMN "renewalAppliedRank" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "renewalAppliedId" VARCHAR(128);

-- A recorded revocation fact must carry its full ordering identity.
ALTER TABLE "IapTransaction"
  ADD CONSTRAINT "IapTransaction_revocation_fact_complete"
  CHECK (
    ("revocationFactAt" IS NULL AND "revocationFactType" IS NULL AND "revocationFactId" IS NULL)
    OR ("revocationFactAt" IS NOT NULL AND "revocationFactType" IS NOT NULL AND "revocationFactId" IS NOT NULL)
  );

ALTER TABLE "SubscriptionEntitlement"
  ADD CONSTRAINT "SubscriptionEntitlement_renewal_fact_complete"
  CHECK (
    ("renewalAppliedAt" IS NULL AND "renewalAppliedId" IS NULL)
    OR ("renewalAppliedAt" IS NOT NULL AND "renewalAppliedId" IS NOT NULL)
  );
