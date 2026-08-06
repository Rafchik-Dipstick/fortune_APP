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
import { createAuthoritativeAuthentication } from './middleware/authentication.js';
import { LoggerFortuneDrawTelemetry } from './observability/fortune-draw-telemetry.js';
import { IapApplicationService } from './iap/application.js';
import { CommerceService } from './iap/commerce.js';
import { findBindingByToken } from './iap/purchase-token.js';
import { AppleSignedDataVerifier } from './iap/verification.js';
import { registerAuthenticationRoutes } from './routes/authentication.js';
import { registerCollectionRoutes } from './routes/collection.js';
import { registerFortuneRoutes } from './routes/fortunes.js';
import { registerIapRoutes } from './routes/iap.js';

export interface ApiRuntime {
  app: Express;
  database: DatabaseRuntime;
  environment: ApiEnvironment;
  logger: ApiLogger;
  readiness: ApiReadiness;
}

export const createApiRuntime = (source: NodeJS.ProcessEnv): ApiRuntime => {
  const environment = parseApiEnvironment(source);
  const logger = createApiLogger(environment);
  const database = createDatabaseRuntime(environment.databaseUrl);
  const readiness = new ApiReadiness(database.checkReadiness);
  const accessTokens = new AccessTokenService(environment.authentication);
  const gameCenterPublicKeys = new CachedGameCenterPublicKeyProvider(environment.authentication);
  const gameCenterProofs = new GameCenterProofVerifier(
    environment.authentication,
    gameCenterPublicKeys,
  );
  const gameCenterLogin = new GameCenterLoginService({
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
  const purchaseTokenKeys = {
    encryptionKeys: environment.authentication.appAccountTokenEncryptionKeys,
    hmacKeys: environment.authentication.appAccountTokenHmacKeys,
  };
  const signedDataVerifier = new AppleSignedDataVerifier({
    appAppleId: environment.commerce.appAppleId,
    bundleId: environment.authentication.bundleId,
    commerce: {
      environment: environment.commerce.environment,
      expectedSubscriptionBillingPlanType:
        environment.commerce.expectedSubscriptionBillingPlanType,
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
  const app = createApiApp({
    environment,
    logger,
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
    },
  });

  return { app, database, environment, logger, readiness };
};
