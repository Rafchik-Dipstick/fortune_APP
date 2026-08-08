import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { allowNonPersistentGameCenterIds } from './game-center-allowance';

describe('temporary Game Center identifier allowance', () => {
  it('is granted, so a release build reaches the server instead of refusing locally', () => {
    // Game Center reports scoped identifiers as non-persistent for any app it
    // has not seen published, which is the build App Review runs. A client
    // that refuses one blocks the only sign-in the app offers.
    expect(allowNonPersistentGameCenterIds).toBe(true);
  });

  it('is what the authentication provider actually passes to the coordinator', () => {
    // The coordinator was already covered for both settings; nothing covered
    // the value the wiring hands it, which is where this broke. Asserting the
    // wiring by source keeps the two from drifting apart again without
    // constructing the React provider and its native dependencies.
    const wiring = readFileSync(new URL('./authentication.tsx', import.meta.url), 'utf8');

    expect(wiring).toContain('allowNonPersistentIds: allowNonPersistentGameCenterIds');
    // The regression this replaces: an expression that resolved to false in
    // every build that was not development.
    expect(wiring).not.toMatch(/allowNonPersistentIds:\s*publicEnvironment/u);
  });
});
