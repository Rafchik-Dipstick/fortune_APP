import { type Express } from 'express';

import { createApiApp } from './app.js';
import { AccessTokenService } from './auth/access-token.js';
import { GameCenterLoginService } from './auth/game-center-login.js';
import { GameCenterProofVerifier } from './auth/game-center-proof.js';
import { CachedGameCenterPublicKeyProvider } from './auth/game-center-public-key.js';
import { type ApiEnvironment, parseApiEnvironment } from './config/environment.js';
import { type DatabaseRuntime, createDatabaseRuntime } from './db/database.js';
import { ApiReadiness } from './health/readiness.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';
import { registerAuthenticationRoutes } from './routes/authentication.js';

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
  const app = createApiApp({
    environment,
    logger,
    readiness,
    configureRoutes: (configuredApp) => {
      registerAuthenticationRoutes(configuredApp, gameCenterLogin);
    },
  });

  return { app, database, environment, logger, readiness };
};
