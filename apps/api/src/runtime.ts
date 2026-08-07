import { type Express } from 'express';

import { createApiApp } from './app.js';
import { AccountBootstrapService } from './auth/account-bootstrap.js';
import { AccessTokenService } from './auth/access-token.js';
import { GameCenterLoginService } from './auth/game-center-login.js';
import { GameCenterProofVerifier } from './auth/game-center-proof.js';
import { CachedGameCenterPublicKeyProvider } from './auth/game-center-public-key.js';
import { LogoutSessionService } from './auth/logout-session.js';
import { RefreshSessionService } from './auth/refresh-session.js';
import { type ApiEnvironment, parseApiEnvironment } from './config/environment.js';
import { type DatabaseRuntime, createDatabaseRuntime } from './db/database.js';
import { ApiReadiness } from './health/readiness.js';
import { FortuneArchiveService } from './fortune/archive.js';
import { CollectionService } from './fortune/collection.js';
import { FortuneStateService } from './fortune/state.js';
import { FortuneDrawService } from './fortune/draw.js';
import { FortuneViewedService } from './fortune/viewed.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';
import { ConsumptionConsentService } from './account/consumption-consent.js';
import { AccountDeletionService } from './account/deletion.js';
import { DeletionManagementTokenService } from './account/deletion-management-token.js';
import { PreferencesService } from './account/preferences.js';
import { AccountPurgeWorker } from './account/purge.js';
import { createAuthoritativeAuthentication } from './middleware/authentication.js';
import { createDeletionManagementAuthentication } from './middleware/deletion-management.js';
import { createErrorReporter, type ErrorReporter } from './observability/error-reporter.js';
import { LoggerFortuneDrawTelemetry } from './observability/fortune-draw-telemetry.js';
import { installDatabaseMetricsRecorder, MetricsRegistry } from './observability/metrics.js';
import { describeOutboundDestinations } from './security/egress-inventory.js';
import { IapApplicationService } from './iap/application.js';
import { AppleAppStoreServerClient } from './iap/app-store-server-client.js';
import { CommerceService } from './iap/commerce.js';
import { ConsumptionService } from './iap/consumption.js';
import { createCommerceBackgroundJobs, type CommerceBackgroundJobs } from './iap/jobs.js';
import {
  AppStoreNotificationIngestService,
  AppStoreNotificationWorker,
} from './iap/notifications.js';
import { findBindingByToken } from './iap/purchase-token.js';
import { AppStoreReconciliationJob } from './iap/reconciliation.js';
import { AppleSignedDataVerifier } from './iap/verification.js';
import { AccountTimeZoneService } from './fortune/time-zone-change.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerAuthenticationRoutes } from './routes/authentication.js';
import { registerCollectionRoutes } from './routes/collection.js';
import { registerFortuneRoutes } from './routes/fortunes.js';
import { registerIapRoutes } from './routes/iap.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

export interface ApiRuntime {
  app: Express;
  backgroundJobs: CommerceBackgroundJobs;
  database: DatabaseRuntime;
  environment: ApiEnvironment;
  errorReporter: ErrorReporter;
  logger: ApiLogger;
  metrics: MetricsRegistry;
  readiness: ApiReadiness;
}

export const createApiRuntime = (source: NodeJS.ProcessEnv): ApiRuntime => {
  const environment = parseApiEnvironment(source);
  const logger = createApiLogger(environment);
  const errorReporter = createErrorReporter(environment, logger);
  const metrics = new MetricsRegistry();
  installDatabaseMetricsRecorder(metrics);
  const database = createDatabaseRuntime(environment.database);
  const readiness = new ApiReadiness(database.checkReadiness);
  const accessTokens = new AccessTokenService(environment.authentication);
  const deletionManagementTokens = new DeletionManagementTokenService(environment.authentication);
  const gameCenterPublicKeys = new CachedGameCenterPublicKeyProvider(environment.authentication);
  const gameCenterProofs = new GameCenterProofVerifier(
    environment.authentication,
    gameCenterPublicKeys,
  );
  const gameCenterLogin = new GameCenterLoginService({
    deletionManagementTokens,
    accessTokens,
    client: database.client,
    environment: environment.authentication,
    proofVerifier: gameCenterProofs,
  });
  const refreshSessions = new RefreshSessionService({
    accessTokens,
    client: database.client,
    environment: environment.authentication,
  });
  const logoutSessions = new LogoutSessionService(database.client);
  const accountBootstrap = new AccountBootstrapService(database.client, environment.authentication);
  const fortuneState = new FortuneStateService(database.client);
  const fortuneDraw = new FortuneDrawService({ client: database.client });
  const fortuneViewed = new FortuneViewedService(database.client);
  const fortuneArchive = new FortuneArchiveService(
    database.client,
    environment.archive.historyCursorHmacKeys,
  );
  const collection = new CollectionService(
    database.client,
    environment.archive.historyCursorHmacKeys,
  );
  const fortuneDrawTelemetry = new LoggerFortuneDrawTelemetry(logger);
  const authenticate = createAuthoritativeAuthentication(database.client, accessTokens);
  const authenticateDeletionManagement = createDeletionManagementAuthentication(
    database.client,
    deletionManagementTokens,
  );
  const accountTimeZones = new AccountTimeZoneService(database.client);
  const preferences = new PreferencesService(database.client, accountTimeZones);
  const accountDeletion = new AccountDeletionService({ client: database.client });
  const accountPurge = new AccountPurgeWorker({
    client: database.client,
    workerId: `api-${process.pid.toString()}`,
  });
  const purchaseTokenKeys = {
    encryptionKeys: environment.authentication.appAccountTokenEncryptionKeys,
    hmacKeys: environment.authentication.appAccountTokenHmacKeys,
  };
  const signedDataVerifier = new AppleSignedDataVerifier({
    appAppleId: environment.commerce.appAppleId,
    bundleId: environment.authentication.bundleId,
    commerce: {
      environment: environment.commerce.environment,
      expectedSubscriptionBillingPlanType: environment.commerce.expectedSubscriptionBillingPlanType,
      fortunePack10ProductId: environment.commerce.fortunePack10ProductId,
      oraclePlusMonthlyProductId: environment.commerce.oraclePlusMonthlyProductId,
    },
  });
  const iapApplication = new IapApplicationService({
    client: database.client,
    resolveTokenOwner: (transaction, rawToken) =>
      findBindingByToken(transaction, rawToken, purchaseTokenKeys.hmacKeys),
  });
  const commerce = new CommerceService({
    application: iapApplication,
    client: database.client,
    commerce: environment.commerce,
    tokenKeys: purchaseTokenKeys,
    verifier: signedDataVerifier,
  });
  const appStoreServerClient =
    environment.commerce.appStoreServerApi === null || environment.commerce.environment === 'XCODE'
      ? undefined
      : new AppleAppStoreServerClient(
          environment.commerce.appStoreServerApi,
          environment.authentication.bundleId,
          environment.commerce.environment,
          { timeoutMs: environment.outboundRequestTimeoutMs },
        );
  const notificationIngest = new AppStoreNotificationIngestService({
    client: database.client,
    commerce: environment.commerce,
    verifier: signedDataVerifier,
  });
  const consumptionConsent = new ConsumptionConsentService(database.client, environment.commerce);
  const consumption = new ConsumptionService({
    client: database.client,
    commerce: environment.commerce,
    logger,
    ...(appStoreServerClient === undefined ? {} : { sender: appStoreServerClient }),
  });
  const notificationWorker = new AppStoreNotificationWorker({
    application: iapApplication,
    client: database.client,
    commerce: environment.commerce,
    consumption,
    logger,
    verifier: signedDataVerifier,
  });
  const reconciliation =
    appStoreServerClient === undefined
      ? undefined
      : new AppStoreReconciliationJob({
          application: iapApplication,
          client: database.client,
          connectionString: environment.databaseUrl,
          logger,
          source: appStoreServerClient,
          verifier: signedDataVerifier,
        });
  const backgroundJobs = createCommerceBackgroundJobs({
    accountPurge,
    errorReporter,
    logger,
    metrics,
    metricsFlushIntervalMs: environment.observability.metricsFlushIntervalMs,
    worker: notificationWorker,
    ...(reconciliation === undefined ? {} : { reconciliation }),
  });
  const app = createApiApp({
    environment,
    errorReporter,
    logger,
    metrics,
    readiness,
    configureRoutes: (configuredApp) => {
      registerAuthenticationRoutes(configuredApp, {
        authenticate,
        bootstrap: accountBootstrap,
        login: gameCenterLogin,
        logout: logoutSessions,
        refresh: refreshSessions,
      });
      registerFortuneRoutes(configuredApp, {
        archive: fortuneArchive,
        authenticate,
        draw: fortuneDraw,
        state: fortuneState,
        telemetry: fortuneDrawTelemetry,
        viewed: fortuneViewed,
      });
      registerCollectionRoutes(configuredApp, { authenticate, collection });
      registerIapRoutes(configuredApp, { authenticate, commerce });
      registerWebhookRoutes(configuredApp, { appStoreNotifications: notificationIngest });
      registerAccountRoutes(configuredApp, {
        authenticate,
        authenticateDeletionManagement,
        consumptionConsent,
        deletion: {
          cancel: async (userId, authenticatedAt) => {
            await accountDeletion.cancel(userId);
            // The restored session inherits the proof time that produced the
            // deletion-management token, so cancelling never manufactures a
            // fresher Game Center proof than the player actually presented.
            return gameCenterLogin.issueRestoredSession({ authenticatedAt, userId });
          },
          request: (authentication, confirmations) =>
            accountDeletion.request(authentication, confirmations),
          status: (userId) => accountDeletion.status(userId),
        },
        preferences,
      });
    },
  });

  // Recording the declared egress surface at startup makes the deployed
  // reality diffable against the runbook without shell access to the instance.
  logger.info(
    {
      destinations: describeOutboundDestinations(environment).map((entry) => ({
        enforcement: entry.enforcement,
        hosts: entry.hosts,
        scheme: entry.scheme,
      })),
      event: 'egress_inventory',
    },
    'declared outbound destinations',
  );

  return { app, backgroundJobs, database, environment, errorReporter, logger, metrics, readiness };
};
