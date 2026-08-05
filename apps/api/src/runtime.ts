import { type Express } from 'express';

import { createApiApp } from './app.js';
import { type ApiEnvironment, parseApiEnvironment } from './config/environment.js';
import { type DatabaseRuntime, createDatabaseRuntime } from './db/database.js';
import { ApiReadiness } from './health/readiness.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';

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
  const app = createApiApp({ environment, logger, readiness });

  return { app, database, environment, logger, readiness };
};
