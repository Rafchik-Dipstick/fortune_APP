import { describe, expect, it } from 'vitest';

import { apiWorkspace } from './index.js';

describe('API workspace scaffold', () => {
  it('reserves the canonical public paths', () => {
    expect(apiWorkspace).toEqual({
      healthPath: '/health',
      publicApiPrefix: '/v1',
      runtime: 'node',
    });
  });
});
