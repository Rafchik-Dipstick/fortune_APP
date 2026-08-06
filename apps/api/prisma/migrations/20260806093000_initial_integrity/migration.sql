-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DELETION_PENDING', 'PURGED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ExternalIdentityProvider" AS ENUM ('GAME_CENTER', 'SIGN_IN_WITH_APPLE');

-- CreateEnum
CREATE TYPE "Arcana" AS ENUM ('MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "TarotSuit" AS ENUM ('WANDS', 'CUPS', 'SWORDS', 'PENTACLES');

-- CreateEnum
CREATE TYPE "TarotRank" AS ENUM ('ACE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'PAGE', 'KNIGHT', 'QUEEN', 'KING');

-- CreateEnum
CREATE TYPE "Orientation" AS ENUM ('UPRIGHT', 'REVERSED');

-- CreateEnum
CREATE TYPE "FortuneIntention" AS ENUM ('GENERAL', 'LOVE', 'WORK', 'GROWTH');

-- CreateEnum
CREATE TYPE "AllowanceSource" AS ENUM ('FREE_DAILY', 'SUBSCRIPTION_DAILY', 'PACK_CREDIT');

-- CreateEnum
CREATE TYPE "IdempotencyActorType" AS ENUM ('USER', 'FINANCIAL_SUBJECT', 'APPLE_NOTIFICATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "IdempotencyOutcomeStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "IapEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION', 'XCODE');

-- CreateEnum
CREATE TYPE "IapProductType" AS ENUM ('CONSUMABLE', 'AUTO_RENEWABLE_SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "IapApplicationStatus" AS ENUM ('RECEIVED', 'APPLIED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "IapDisposition" AS ENUM ('PENDING', 'APPLIED', 'ALREADY_APPLIED', 'DELIVERED_TO_OTHER_ACCOUNT', 'OWNER_UNKNOWN', 'OWNER_CLOSED_NO_BENEFIT', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('PACK_PURCHASE', 'FORTUNE_DRAW', 'REFUND_DEBIT', 'REFUND_REINSTATEMENT', 'SUPPORT_ADJUSTMENT', 'MIGRATION');

-- CreateEnum
CREATE TYPE "PackGrantDisposition" AS ENUM ('ACTIVE', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'OWNER_CLOSED');

-- CreateEnum
CREATE TYPE "TokenBindingReason" AS ENUM ('INITIAL', 'ROTATION', 'REPAIR', 'PURGE');

-- CreateEnum
CREATE TYPE "AppStoreNotificationProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'APPLIED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE', 'UNKNOWN_RETAINED');

-- CreateEnum
CREATE TYPE "ConsumptionProductScope" AS ENUM ('CONSUMABLE', 'AUTO_RENEWABLE_SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'PURGED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SUPPORT', 'SYSTEM', 'APPLE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "resolvedLocale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "accountTimeZone" VARCHAR(128) NOT NULL,
    "pendingTimeZone" VARCHAR(128),
    "timeZoneEffectiveAt" TIMESTAMPTZ(3),
    "nextTimeZoneChangeEligibleAt" TIMESTAMPTZ(3),
    "onboardingCompletedAt" TIMESTAMPTZ(3),
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderLocalMinutes" INTEGER NOT NULL DEFAULT 540,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hapticsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reduceMotionPreferred" BOOLEAN NOT NULL DEFAULT false,
    "commerceReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "activeFinancialSubjectId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" UUID NOT NULL,
    "provider" "ExternalIdentityProvider" NOT NULL,
    "userId" UUID NOT NULL,
    "keyVersion" VARCHAR(32) NOT NULL,
    "subjectDigest" CHAR(64) NOT NULL,
    "secondaryKeyVersion" VARCHAR(32),
    "secondaryMigrationDigest" CHAR(64),
    "lastAuthenticatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionFamily" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameCenterAuthenticatedAt" TIMESTAMPTZ(3) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "predecessorId" UUID,
    "consumedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "requestHash" CHAR(64),
    "idempotencyKey" UUID,
    "deviceIdHash" CHAR(64),
    "deviceDescription" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshReplayReceipt" (
    "id" UUID NOT NULL,
    "refreshTokenId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "encryptedResponse" BYTEA NOT NULL,
    "encryptionKeyVersion" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshReplayReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "actorType" "IdempotencyActorType" NOT NULL,
    "actorId" VARCHAR(128) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "normalizedRoute" VARCHAR(160) NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "outcomeStatus" "IdempotencyOutcomeStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "resultReference" VARCHAR(160),
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retainUntil" TIMESTAMPTZ(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSubject" (
    "id" UUID NOT NULL,
    "benefitsDisabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppAccountTokenBinding" (
    "id" UUID NOT NULL,
    "financialSubjectId" UUID NOT NULL,
    "keyVersion" VARCHAR(32) NOT NULL,
    "tokenDigest" CHAR(64) NOT NULL,
    "encryptedToken" BYTEA,
    "encryptionKeyVersion" VARCHAR(32),
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMPTZ(3),
    "cryptoErasedAt" TIMESTAMPTZ(3),
    "reason" "TokenBindingReason" NOT NULL,
    "rotatedFromBindingId" UUID,
    "auditEventId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppAccountTokenBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarotCard" (
    "key" VARCHAR(48) NOT NULL,
    "displayNumber" VARCHAR(16) NOT NULL,
    "nameEn" VARCHAR(80) NOT NULL,
    "arcana" "Arcana" NOT NULL,
    "suit" "TarotSuit",
    "rank" "TarotRank",
    "assetKey" VARCHAR(80) NOT NULL,
    "illustrationAltEn" VARCHAR(500) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TarotCard_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FortuneTemplate" (
    "id" UUID NOT NULL,
    "cardKey" VARCHAR(48) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "orientation" "Orientation" NOT NULL,
    "intention" "FortuneIntention" NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 1,
    "headline" VARCHAR(120) NOT NULL,
    "message" VARCHAR(1200) NOT NULL,
    "gentleAction" VARCHAR(500) NOT NULL,
    "affirmation" VARCHAR(300) NOT NULL,
    "contentVersion" VARCHAR(48) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FortuneTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowancePeriod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,
    "timeZoneSnapshot" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowancePeriod_pkey" PRIMARY KEY ("userId","id")
);

-- CreateTable
CREATE TABLE "AllowanceUsage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "allowancePeriodId" UUID NOT NULL,
    "freeUsed" INTEGER NOT NULL DEFAULT 0,
    "subscriptionUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AllowanceUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FortuneDraw" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cardKey" VARCHAR(48) NOT NULL,
    "templateId" UUID NOT NULL,
    "allowancePeriodId" UUID NOT NULL,
    "allowanceSource" "AllowanceSource" NOT NULL,
    "intention" "FortuneIntention" NOT NULL,
    "orientation" "Orientation" NOT NULL,
    "resolvedLocale" VARCHAR(16) NOT NULL,
    "sequence" BIGINT NOT NULL,
    "cardDisplayNumber" VARCHAR(16) NOT NULL,
    "cardNameSnapshot" VARCHAR(80) NOT NULL,
    "illustrationAltSnapshot" VARCHAR(500) NOT NULL,
    "headlineSnapshot" VARCHAR(120) NOT NULL,
    "messageSnapshot" VARCHAR(1200) NOT NULL,
    "gentleActionSnapshot" VARCHAR(500) NOT NULL,
    "affirmationSnapshot" VARCHAR(300) NOT NULL,
    "contentVersionSnapshot" VARCHAR(48) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMPTZ(3),
    "clientIdempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,

    CONSTRAINT "FortuneDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IapTransaction" (
    "id" UUID NOT NULL,
    "environment" "IapEnvironment" NOT NULL,
    "transactionId" VARCHAR(64) NOT NULL,
    "originalTransactionId" VARCHAR(64) NOT NULL,
    "productId" VARCHAR(160) NOT NULL,
    "productType" "IapProductType" NOT NULL,
    "billingPlanType" VARCHAR(64),
    "financialSubjectId" UUID NOT NULL,
    "tokenBindingId" UUID,
    "purchaseAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "revocationAt" TIMESTAMPTZ(3),
    "revocationReason" VARCHAR(64),
    "revocationPercentage" INTEGER,
    "applicationStatus" "IapApplicationStatus" NOT NULL DEFAULT 'RECEIVED',
    "disposition" "IapDisposition" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMPTZ(3),
    "normalizedPayload" JSONB NOT NULL,
    "jwsHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IapTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackCreditGrant" (
    "id" UUID NOT NULL,
    "financialSubjectId" UUID NOT NULL,
    "purchaseTransactionId" UUID NOT NULL,
    "originalUnits" INTEGER NOT NULL DEFAULT 10,
    "drawnUnits" INTEGER NOT NULL DEFAULT 0,
    "currentRefundTargetUnits" INTEGER NOT NULL DEFAULT 0,
    "currentRefundedUnspentUnits" INTEGER NOT NULL DEFAULT 0,
    "currentUnrecoveredRefundUnits" INTEGER NOT NULL DEFAULT 0,
    "greatestRefundSourceAt" TIMESTAMPTZ(3),
    "greatestRefundSourceId" VARCHAR(128),
    "greatestRefundSourceType" VARCHAR(64),
    "disposition" "PackGrantDisposition" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PackCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" UUID NOT NULL,
    "financialSubjectId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "grantId" UUID,
    "purchaseTransactionId" UUID,
    "drawId" UUID,
    "refundSourceId" VARCHAR(128),
    "effectKey" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEntitlement" (
    "id" UUID NOT NULL,
    "environment" "IapEnvironment" NOT NULL,
    "originalTransactionId" VARCHAR(64) NOT NULL,
    "financialSubjectId" UUID NOT NULL,
    "productId" VARCHAR(160) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "paidThrough" TIMESTAMPTZ(3),
    "graceThrough" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "autoRenewEnabled" BOOLEAN,
    "lastAppleEventTime" TIMESTAMPTZ(3) NOT NULL,
    "lastAppleSourceId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppStoreNotification" (
    "id" UUID NOT NULL,
    "notificationUuid" UUID NOT NULL,
    "notificationType" VARCHAR(80) NOT NULL,
    "notificationSubtype" VARCHAR(80),
    "environment" "IapEnvironment" NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "encryptedPayload" BYTEA,
    "encryptionKeyVersion" VARCHAR(32),
    "payloadDeleteAt" TIMESTAMPTZ(3),
    "processingStatus" "AppStoreNotificationProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "leaseOwner" VARCHAR(128),
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "sourceAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppStoreNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionConsent" (
    "id" UUID NOT NULL,
    "financialSubjectId" UUID NOT NULL,
    "policyVersion" VARCHAR(48) NOT NULL,
    "scope" "ConsumptionProductScope" NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "auditProof" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),
    "leaseOwner" VARCHAR(128),
    "leaseUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" VARCHAR(128),
    "action" VARCHAR(120) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" VARCHAR(128),
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_activeFinancialSubjectId_key" ON "User"("activeFinancialSubjectId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_timeZoneEffectiveAt_idx" ON "User"("timeZoneEffectiveAt");

-- CreateIndex
CREATE INDEX "ExternalIdentity_provider_secondaryKeyVersion_secondaryMigr_idx" ON "ExternalIdentity"("provider", "secondaryKeyVersion", "secondaryMigrationDigest");

-- CreateIndex
CREATE INDEX "ExternalIdentity_userId_provider_idx" ON "ExternalIdentity"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_keyVersion_subjectDigest_key" ON "ExternalIdentity"("provider", "keyVersion", "subjectDigest");

-- CreateIndex
CREATE INDEX "SessionFamily_userId_revokedAt_expiresAt_idx" ON "SessionFamily"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_predecessorId_key" ON "RefreshToken"("predecessorId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_expiresAt_idx" ON "RefreshToken"("familyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_familyId_idempotencyKey_key" ON "RefreshToken"("familyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshReplayReceipt_refreshTokenId_key" ON "RefreshReplayReceipt"("refreshTokenId");

-- CreateIndex
CREATE INDEX "RefreshReplayReceipt_expiresAt_idx" ON "RefreshReplayReceipt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshReplayReceipt_refreshTokenId_idempotencyKey_key" ON "RefreshReplayReceipt"("refreshTokenId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_retainUntil_idx" ON "IdempotencyRecord"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorType_actorId_method_normalizedRoute__key" ON "IdempotencyRecord"("actorType", "actorId", "method", "normalizedRoute", "key");

-- CreateIndex
CREATE INDEX "FinancialSubject_benefitsDisabledAt_idx" ON "FinancialSubject"("benefitsDisabledAt");

-- CreateIndex
CREATE INDEX "AppAccountTokenBinding_financialSubjectId_validTo_idx" ON "AppAccountTokenBinding"("financialSubjectId", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "AppAccountTokenBinding_keyVersion_tokenDigest_key" ON "AppAccountTokenBinding"("keyVersion", "tokenDigest");

-- CreateIndex
CREATE UNIQUE INDEX "TarotCard_assetKey_key" ON "TarotCard"("assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "TarotCard_sortOrder_key" ON "TarotCard"("sortOrder");

-- CreateIndex
CREATE INDEX "TarotCard_arcana_suit_sortOrder_idx" ON "TarotCard"("arcana", "suit", "sortOrder");

-- CreateIndex
CREATE INDEX "FortuneTemplate_locale_intention_orientation_active_idx" ON "FortuneTemplate"("locale", "intention", "orientation", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FortuneTemplate_cardKey_locale_orientation_intention_varian_key" ON "FortuneTemplate"("cardKey", "locale", "orientation", "intention", "variant", "contentVersion");

-- CreateIndex
CREATE INDEX "AllowancePeriod_userId_startedAt_resetAt_idx" ON "AllowancePeriod"("userId", "startedAt", "resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "AllowancePeriod_userId_sequence_key" ON "AllowancePeriod"("userId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AllowancePeriod_userId_id_key" ON "AllowancePeriod"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AllowanceUsage_allowancePeriodId_key" ON "AllowanceUsage"("allowancePeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowanceUsage_userId_allowancePeriodId_key" ON "AllowanceUsage"("userId", "allowancePeriodId");

-- CreateIndex
CREATE INDEX "FortuneDraw_userId_issuedAt_id_idx" ON "FortuneDraw"("userId", "issuedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "FortuneDraw_userId_cardKey_issuedAt_idx" ON "FortuneDraw"("userId", "cardKey", "issuedAt" DESC);

-- CreateIndex
CREATE INDEX "FortuneDraw_userId_viewedAt_idx" ON "FortuneDraw"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FortuneDraw_userId_clientIdempotencyKey_key" ON "FortuneDraw"("userId", "clientIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FortuneDraw_userId_sequence_key" ON "FortuneDraw"("userId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "FortuneDraw_userId_id_key" ON "FortuneDraw"("userId", "id");

-- CreateIndex
CREATE INDEX "IapTransaction_environment_originalTransactionId_idx" ON "IapTransaction"("environment", "originalTransactionId");

-- CreateIndex
CREATE INDEX "IapTransaction_financialSubjectId_purchaseAt_idx" ON "IapTransaction"("financialSubjectId", "purchaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "IapTransaction_environment_transactionId_key" ON "IapTransaction"("environment", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PackCreditGrant_purchaseTransactionId_key" ON "PackCreditGrant"("purchaseTransactionId");

-- CreateIndex
CREATE INDEX "PackCreditGrant_financialSubjectId_createdAt_idx" ON "PackCreditGrant"("financialSubjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_drawId_key" ON "CreditLedgerEntry"("drawId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_effectKey_key" ON "CreditLedgerEntry"("effectKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_financialSubjectId_createdAt_id_idx" ON "CreditLedgerEntry"("financialSubjectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_grantId_createdAt_idx" ON "CreditLedgerEntry"("grantId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEntitlement_financialSubjectId_status_paidThrou_idx" ON "SubscriptionEntitlement"("financialSubjectId", "status", "paidThrough");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEntitlement_environment_originalTransactionId_key" ON "SubscriptionEntitlement"("environment", "originalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AppStoreNotification_notificationUuid_key" ON "AppStoreNotification"("notificationUuid");

-- CreateIndex
CREATE INDEX "AppStoreNotification_processingStatus_leaseExpiresAt_receiv_idx" ON "AppStoreNotification"("processingStatus", "leaseExpiresAt", "receivedAt");

-- CreateIndex
CREATE INDEX "AppStoreNotification_payloadDeleteAt_idx" ON "AppStoreNotification"("payloadDeleteAt");

-- CreateIndex
CREATE INDEX "ConsumptionConsent_financialSubjectId_scope_revokedAt_idx" ON "ConsumptionConsent"("financialSubjectId", "scope", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionConsent_financialSubjectId_policyVersion_scope_key" ON "ConsumptionConsent"("financialSubjectId", "policyVersion", "scope");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_purgeAt_leaseUntil_idx" ON "AccountDeletionRequest"("status", "purgeAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx" ON "AccountDeletionRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorType_actorId_createdAt_idx" ON "AuditEvent"("actorType", "actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeFinancialSubjectId_fkey" FOREIGN KEY ("activeFinancialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFamily" ADD CONSTRAINT "SessionFamily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "SessionFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshReplayReceipt" ADD CONSTRAINT "RefreshReplayReceipt_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "RefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppAccountTokenBinding" ADD CONSTRAINT "AppAccountTokenBinding_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppAccountTokenBinding" ADD CONSTRAINT "AppAccountTokenBinding_rotatedFromBindingId_fkey" FOREIGN KEY ("rotatedFromBindingId") REFERENCES "AppAccountTokenBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortuneTemplate" ADD CONSTRAINT "FortuneTemplate_cardKey_fkey" FOREIGN KEY ("cardKey") REFERENCES "TarotCard"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowancePeriod" ADD CONSTRAINT "AllowancePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowanceUsage" ADD CONSTRAINT "AllowanceUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowanceUsage" ADD CONSTRAINT "AllowanceUsage_userId_allowancePeriodId_fkey" FOREIGN KEY ("userId", "allowancePeriodId") REFERENCES "AllowancePeriod"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortuneDraw" ADD CONSTRAINT "FortuneDraw_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortuneDraw" ADD CONSTRAINT "FortuneDraw_cardKey_fkey" FOREIGN KEY ("cardKey") REFERENCES "TarotCard"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortuneDraw" ADD CONSTRAINT "FortuneDraw_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FortuneTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FortuneDraw" ADD CONSTRAINT "FortuneDraw_userId_allowancePeriodId_fkey" FOREIGN KEY ("userId", "allowancePeriodId") REFERENCES "AllowancePeriod"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IapTransaction" ADD CONSTRAINT "IapTransaction_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IapTransaction" ADD CONSTRAINT "IapTransaction_tokenBindingId_fkey" FOREIGN KEY ("tokenBindingId") REFERENCES "AppAccountTokenBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackCreditGrant" ADD CONSTRAINT "PackCreditGrant_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackCreditGrant" ADD CONSTRAINT "PackCreditGrant_purchaseTransactionId_fkey" FOREIGN KEY ("purchaseTransactionId") REFERENCES "IapTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "PackCreditGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_purchaseTransactionId_fkey" FOREIGN KEY ("purchaseTransactionId") REFERENCES "IapTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "FortuneDraw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEntitlement" ADD CONSTRAINT "SubscriptionEntitlement_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionConsent" ADD CONSTRAINT "ConsumptionConsent_financialSubjectId_fkey" FOREIGN KEY ("financialSubjectId") REFERENCES "FinancialSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PostgreSQL integrity that Prisma Schema Language cannot express.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE UNIQUE INDEX "FortuneDraw_one_unviewed_per_user_key"
ON "FortuneDraw"("userId")
WHERE "viewedAt" IS NULL;

CREATE UNIQUE INDEX "FortuneTemplate_one_active_logical_variant_key"
ON "FortuneTemplate"("cardKey", "locale", "orientation", "intention", "variant")
WHERE "active" = true;

CREATE UNIQUE INDEX "AppAccountTokenBinding_one_current_recoverable_key"
ON "AppAccountTokenBinding"("financialSubjectId")
WHERE "validTo" IS NULL AND "cryptoErasedAt" IS NULL AND "encryptedToken" IS NOT NULL;

CREATE UNIQUE INDEX "AccountDeletionRequest_one_pending_per_user_key"
ON "AccountDeletionRequest"("userId")
WHERE "status" = 'PENDING';

ALTER TABLE "AllowancePeriod"
ADD CONSTRAINT "AllowancePeriod_non_overlapping_ranges_excl"
EXCLUDE USING gist (
  "userId" WITH =,
  tstzrange("startedAt", "resetAt", '[)') WITH &&
);

ALTER TABLE "User"
ADD CONSTRAINT "User_session_version_positive_check" CHECK ("sessionVersion" >= 1),
ADD CONSTRAINT "User_reminder_minutes_check" CHECK ("reminderLocalMinutes" BETWEEN 0 AND 1439),
ADD CONSTRAINT "User_pending_time_zone_pair_check" CHECK (
  ("pendingTimeZone" IS NULL AND "timeZoneEffectiveAt" IS NULL)
  OR ("pendingTimeZone" IS NOT NULL AND "timeZoneEffectiveAt" IS NOT NULL)
);

ALTER TABLE "ExternalIdentity"
ADD CONSTRAINT "ExternalIdentity_secondary_digest_pair_check" CHECK (
  ("secondaryKeyVersion" IS NULL AND "secondaryMigrationDigest" IS NULL)
  OR ("secondaryKeyVersion" IS NOT NULL AND "secondaryMigrationDigest" IS NOT NULL)
);

ALTER TABLE "SessionFamily"
ADD CONSTRAINT "SessionFamily_expiry_check" CHECK ("expiresAt" > "issuedAt"),
ADD CONSTRAINT "SessionFamily_revocation_pair_check" CHECK (
  ("revokedAt" IS NULL AND "revocationReason" IS NULL)
  OR ("revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
);

ALTER TABLE "RefreshToken"
ADD CONSTRAINT "RefreshToken_expiry_check" CHECK ("expiresAt" > "createdAt"),
ADD CONSTRAINT "RefreshToken_consumption_request_pair_check" CHECK (
  "consumedAt" IS NULL OR ("requestHash" IS NOT NULL AND "idempotencyKey" IS NOT NULL)
);

ALTER TABLE "RefreshReplayReceipt"
ADD CONSTRAINT "RefreshReplayReceipt_expiry_window_check" CHECK (
  "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '120 seconds'
);

ALTER TABLE "IdempotencyRecord"
ADD CONSTRAINT "IdempotencyRecord_terminal_outcome_check" CHECK (
  ("outcomeStatus" = 'PENDING' AND "httpStatus" IS NULL)
  OR ("outcomeStatus" = 'COMPLETED' AND "httpStatus" BETWEEN 200 AND 599)
);

ALTER TABLE "AppAccountTokenBinding"
ADD CONSTRAINT "AppAccountTokenBinding_validity_check" CHECK (
  "validTo" IS NULL OR "validTo" > "validFrom"
),
ADD CONSTRAINT "AppAccountTokenBinding_encryption_pair_check" CHECK (
  ("encryptedToken" IS NULL AND "encryptionKeyVersion" IS NULL)
  OR ("encryptedToken" IS NOT NULL AND "encryptionKeyVersion" IS NOT NULL)
),
ADD CONSTRAINT "AppAccountTokenBinding_erasure_check" CHECK (
  "cryptoErasedAt" IS NULL OR ("encryptedToken" IS NULL AND "encryptionKeyVersion" IS NULL)
);

ALTER TABLE "TarotCard"
ADD CONSTRAINT "TarotCard_arcana_structure_check" CHECK (
  ("arcana" = 'MAJOR' AND "suit" IS NULL AND "rank" IS NULL)
  OR ("arcana" = 'MINOR' AND "suit" IS NOT NULL AND "rank" IS NOT NULL)
),
ADD CONSTRAINT "TarotCard_required_copy_check" CHECK (
  btrim("key") <> '' AND btrim("nameEn") <> '' AND btrim("assetKey") <> ''
  AND btrim("illustrationAltEn") <> ''
);

ALTER TABLE "FortuneTemplate"
ADD CONSTRAINT "FortuneTemplate_variant_positive_check" CHECK ("variant" >= 1),
ADD CONSTRAINT "FortuneTemplate_required_copy_check" CHECK (
  btrim("locale") <> '' AND btrim("headline") <> '' AND btrim("message") <> ''
  AND btrim("gentleAction") <> '' AND btrim("affirmation") <> ''
  AND btrim("contentVersion") <> ''
);

ALTER TABLE "AllowancePeriod"
ADD CONSTRAINT "AllowancePeriod_boundary_check" CHECK ("resetAt" > "startedAt"),
ADD CONSTRAINT "AllowancePeriod_sequence_positive_check" CHECK ("sequence" >= 1);

ALTER TABLE "AllowanceUsage"
ADD CONSTRAINT "AllowanceUsage_free_check" CHECK ("freeUsed" BETWEEN 0 AND 1),
ADD CONSTRAINT "AllowanceUsage_subscription_check" CHECK ("subscriptionUsed" BETWEEN 0 AND 10);

ALTER TABLE "FortuneDraw"
ADD CONSTRAINT "FortuneDraw_sequence_positive_check" CHECK ("sequence" >= 1),
ADD CONSTRAINT "FortuneDraw_viewed_after_issue_check" CHECK (
  "viewedAt" IS NULL OR "viewedAt" >= "issuedAt"
),
ADD CONSTRAINT "FortuneDraw_snapshot_copy_check" CHECK (
  btrim("cardNameSnapshot") <> '' AND btrim("illustrationAltSnapshot") <> ''
  AND btrim("headlineSnapshot") <> '' AND btrim("messageSnapshot") <> ''
  AND btrim("gentleActionSnapshot") <> '' AND btrim("affirmationSnapshot") <> ''
  AND btrim("contentVersionSnapshot") <> ''
);

ALTER TABLE "IapTransaction"
ADD CONSTRAINT "IapTransaction_revocation_percentage_check" CHECK (
  "revocationPercentage" IS NULL OR "revocationPercentage" BETWEEN 0 AND 100000
),
ADD CONSTRAINT "IapTransaction_product_shape_check" CHECK (
  ("productType" = 'CONSUMABLE' AND "billingPlanType" IS NULL AND "expiresAt" IS NULL)
  OR ("productType" = 'AUTO_RENEWABLE_SUBSCRIPTION' AND "billingPlanType" IS NOT NULL)
),
ADD CONSTRAINT "IapTransaction_revocation_pair_check" CHECK (
  ("revocationAt" IS NULL AND "revocationReason" IS NULL AND "revocationPercentage" IS NULL)
  OR ("revocationAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
);

ALTER TABLE "PackCreditGrant"
ADD CONSTRAINT "PackCreditGrant_units_check" CHECK (
  "originalUnits" = 10
  AND "drawnUnits" BETWEEN 0 AND 10
  AND "currentRefundTargetUnits" BETWEEN 0 AND 10
  AND "currentRefundedUnspentUnits" BETWEEN 0 AND 10
  AND "currentUnrecoveredRefundUnits" BETWEEN 0 AND 10
  AND "drawnUnits" + "currentRefundedUnspentUnits" <= 10
  AND "currentUnrecoveredRefundUnits" <= "drawnUnits"
  AND "currentRefundTargetUnits" = "currentRefundedUnspentUnits" + "currentUnrecoveredRefundUnits"
),
ADD CONSTRAINT "PackCreditGrant_refund_source_check" CHECK (
  ("greatestRefundSourceAt" IS NULL AND "greatestRefundSourceId" IS NULL AND "greatestRefundSourceType" IS NULL)
  OR ("greatestRefundSourceAt" IS NOT NULL AND "greatestRefundSourceId" IS NOT NULL AND "greatestRefundSourceType" IS NOT NULL)
);

ALTER TABLE "CreditLedgerEntry"
ADD CONSTRAINT "CreditLedgerEntry_nonnegative_balance_check" CHECK ("balanceAfter" >= 0),
ADD CONSTRAINT "CreditLedgerEntry_reason_shape_check" CHECK (
  ("reason" = 'PACK_PURCHASE' AND "delta" = 10 AND "grantId" IS NOT NULL AND "purchaseTransactionId" IS NOT NULL AND "drawId" IS NULL)
  OR ("reason" = 'FORTUNE_DRAW' AND "delta" = -1 AND "grantId" IS NOT NULL AND "drawId" IS NOT NULL)
  OR ("reason" = 'REFUND_DEBIT' AND "delta" BETWEEN -10 AND -1 AND "grantId" IS NOT NULL AND "refundSourceId" IS NOT NULL)
  OR ("reason" = 'REFUND_REINSTATEMENT' AND "delta" BETWEEN 1 AND 10 AND "grantId" IS NOT NULL AND "refundSourceId" IS NOT NULL)
  OR ("reason" IN ('SUPPORT_ADJUSTMENT', 'MIGRATION') AND "delta" <> 0)
);

ALTER TABLE "SubscriptionEntitlement"
ADD CONSTRAINT "SubscriptionEntitlement_period_check" CHECK (
  "graceThrough" IS NULL OR "paidThrough" IS NULL OR "graceThrough" >= "paidThrough"
);

ALTER TABLE "AppStoreNotification"
ADD CONSTRAINT "AppStoreNotification_attempt_count_check" CHECK ("attemptCount" >= 0),
ADD CONSTRAINT "AppStoreNotification_encryption_pair_check" CHECK (
  ("encryptedPayload" IS NULL AND "encryptionKeyVersion" IS NULL)
  OR ("encryptedPayload" IS NOT NULL AND "encryptionKeyVersion" IS NOT NULL)
);

ALTER TABLE "ConsumptionConsent"
ADD CONSTRAINT "ConsumptionConsent_revocation_check" CHECK (
  "revokedAt" IS NULL OR "revokedAt" >= "grantedAt"
);

ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_timeline_check" CHECK (
  "purgeAt" > "requestedAt"
  AND ("cancelledAt" IS NULL OR "cancelledAt" >= "requestedAt")
  AND ("purgedAt" IS NULL OR "purgedAt" >= "requestedAt")
),
ADD CONSTRAINT "AccountDeletionRequest_status_shape_check" CHECK (
  ("status" = 'PENDING' AND "cancelledAt" IS NULL AND "purgedAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "purgedAt" IS NULL)
  OR ("status" = 'PURGED' AND "purgedAt" IS NOT NULL)
);

CREATE FUNCTION "fortuneness_reject_closed_benefit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_id UUID;
BEGIN
  subject_id := NEW."financialSubjectId";
  IF EXISTS (
    SELECT 1 FROM "FinancialSubject"
    WHERE "id" = subject_id AND "benefitsDisabledAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'financial subject benefits are permanently disabled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PackCreditGrant_reject_closed_subject"
BEFORE INSERT OR UPDATE ON "PackCreditGrant"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_reject_closed_benefit_mutation"();

CREATE TRIGGER "CreditLedgerEntry_reject_closed_subject"
BEFORE INSERT OR UPDATE ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_reject_closed_benefit_mutation"();

CREATE TRIGGER "SubscriptionEntitlement_reject_closed_subject"
BEFORE INSERT OR UPDATE ON "SubscriptionEntitlement"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_reject_closed_benefit_mutation"();

CREATE FUNCTION "fortuneness_enforce_financial_cutoff"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_balance BIGINT;
BEGIN
  IF OLD."benefitsDisabledAt" IS NOT NULL AND NEW."benefitsDisabledAt" IS DISTINCT FROM OLD."benefitsDisabledAt" THEN
    RAISE EXCEPTION 'financial benefit cutoff is irreversible'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."benefitsDisabledAt" IS NULL AND NEW."benefitsDisabledAt" IS NOT NULL THEN
    SELECT COALESCE(SUM("delta"), 0)
      INTO current_balance
      FROM "CreditLedgerEntry"
      WHERE "financialSubjectId" = NEW."id";
    IF current_balance <> 0 THEN
      RAISE EXCEPTION 'financial subject balance must be zero before benefit cutoff'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinancialSubject_irreversible_cutoff"
BEFORE UPDATE ON "FinancialSubject"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_financial_cutoff"();

CREATE FUNCTION "fortuneness_reject_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit ledger entries are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "CreditLedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_reject_ledger_mutation"();

CREATE FUNCTION "fortuneness_enforce_immutable_financial_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."financialSubjectId" IS DISTINCT FROM OLD."financialSubjectId" THEN
    RAISE EXCEPTION 'financial ownership is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AppAccountTokenBinding_immutable_owner"
BEFORE UPDATE ON "AppAccountTokenBinding"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_immutable_financial_owner"();

CREATE TRIGGER "IapTransaction_immutable_owner"
BEFORE UPDATE ON "IapTransaction"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_immutable_financial_owner"();

CREATE TRIGGER "PackCreditGrant_immutable_owner"
BEFORE UPDATE ON "PackCreditGrant"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_immutable_financial_owner"();

CREATE TRIGGER "CreditLedgerEntry_immutable_owner"
BEFORE UPDATE ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_immutable_financial_owner"();

CREATE TRIGGER "SubscriptionEntitlement_immutable_owner"
BEFORE UPDATE ON "SubscriptionEntitlement"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_enforce_immutable_financial_owner"();
