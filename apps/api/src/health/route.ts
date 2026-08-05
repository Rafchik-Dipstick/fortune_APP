import { type Express } from 'express';

import { type ApiReadiness } from './readiness.js';

export const registerHealthRoute = (app: Express, readiness: ApiReadiness): void => {
  app.get('/health', async (_request, response) => {
    const snapshot = await readiness.inspect();
    response.status(snapshot.status === 'ready' ? 200 : 503).json(snapshot);
  });
};
