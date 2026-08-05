import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';

describe('createApiApp', () => {
  it('creates isolated applications without opening a listener', async () => {
    const firstApp = createApiApp();
    const secondApp = createApiApp();

    firstApp.get('/factory-probe', (_request, response) => {
      response.status(204).end();
    });

    expect(firstApp).not.toBe(secondApp);
    await request(firstApp).get('/factory-probe').expect(204);
    await request(secondApp).get('/factory-probe').expect(404);
  });
});
