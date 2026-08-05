import { type Express } from 'express';
import { apiPaths, healthResponseSchema } from '@fortuneness/api-contracts';

import { type ApiReadiness } from './readiness.js';

export const registerHealthRoute = (app: Express, readiness: ApiReadiness): void => {
  app.get(apiPaths.health, async (_request, response) => {
    const snapshot = await readiness.inspect();
    const body = healthResponseSchema.parse(snapshot);
    response.status(body.status === 'ready' ? 200 : 503).json(body);
  });
};
