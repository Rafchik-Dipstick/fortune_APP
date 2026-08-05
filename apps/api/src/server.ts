import { type Server } from 'node:http';

import { type Express } from 'express';

export interface ApiServerOptions {
  host: string;
  port: number;
}

/** Opens the process-owned listener for an already configured API app. */
export const startApiServer = (app: Express, options: ApiServerOptions): Server =>
  app.listen(options.port, options.host);
