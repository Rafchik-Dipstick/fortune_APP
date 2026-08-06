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
import { FortuneStateService } from './fortune/state.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';
import { createAuthoritativeAuthentication } from './middleware/authentication.js';
import { registerAuthenticationRoutes } from './routes/authentication.js';
import { registerFortuneRoutes } from './routes/fortunes.js';

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
  const authenticate = createAuthoritativeAuthentication(database.client, accessTokens);
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
        authenticate,
        state: fortuneState,
      });
    },
  });

  return { app, database, environment, logger, readiness };
};
