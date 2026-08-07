import { describe, expect, it, vi } from 'vitest';
import type {
  AccountDeletionRequest,
  AccountDeletionState,
  IapCallerState,
} from '@fortuneness/api-contracts';

import { MobileApiError } from '../auth/api-client';
import {
  buildDeletionRequest,
  describeDeletionState,
  emptyAcknowledgements,
  requiresAppleBillingAcknowledgement,
  submitAccountDeletion,
  type DeletionFlowDependencies,
} from './deletion-flow';

const now = new Date('2026-08-07T12:00:00.000Z');

function callerState(subscription: Partial<IapCallerState['subscription']>): IapCallerState {
  return {
    commerceReviewRequired: false,
    spendablePackCredits: 0,
    subscription: {
      entitled: false,
      graceThrough: null,
      paidThrough: null,
      status: 'NONE',
      ...subscription,
    },
  };
}

const pending: AccountDeletionState = {
  cancelledAt: null,
  purgeAt: '2026-09-06T12:00:00.000Z',
  requestedAt: '2026-08-07T12:00:00.000Z',
  status: 'PENDING',
};

describe('requiresAppleBillingAcknowledgement', () => {
  it('is not required when Apple has nothing left to bill', () => {
    expect(requiresAppleBillingAcknowledgement(callerState({ status: 'NONE' }), now)).toBe(false);
    expect(
      requiresAppleBillingAcknowledgement(
        callerState({ paidThrough: '2026-07-01T00:00:00.000Z', status: 'EXPIRED' }),
        now,
      ),
    ).toBe(false);
  });

  it('is required while a subscription is entitled, retrying, or still paid through', () => {
    expect(
      requiresAppleBillingAcknowledgement(
        callerState({ entitled: true, paidThrough: '2026-09-01T00:00:00.000Z', status: 'ACTIVE' }),
        now,
      ),
    ).toBe(true);
    expect(requiresAppleBillingAcknowledgement(callerState({ status: 'BILLING_RETRY' }), now)).toBe(
      true,
    );
    expect(
      requiresAppleBillingAcknowledgement(
        callerState({ paidThrough: '2026-08-20T00:00:00.000Z', status: 'EXPIRED' }),
        now,
      ),
    ).toBe(true);
  });

  it('assumes billing may continue when the commerce state is unknown', () => {
    expect(requiresAppleBillingAcknowledgement(undefined, now)).toBe(true);
  });
});

describe('buildDeletionRequest', () => {
  it('withholds the request until the standard acknowledgements are ticked', () => {
    expect(buildDeletionRequest(emptyAcknowledgements, false)).toBeUndefined();
    expect(
      buildDeletionRequest({ ...emptyAcknowledgements, accessEnds: true }, false),
    ).toBeUndefined();
  });

  it('withholds the request until the billing acknowledgement is ticked when it applies', () => {
    const both = { accessEnds: true, appleBilling: false, dataLoss: true };
    expect(buildDeletionRequest(both, true)).toBeUndefined();
    expect(buildDeletionRequest({ ...both, appleBilling: true }, true)).toEqual({
      acknowledgedAccessEnds: true,
      acknowledgedAppleBilling: true,
      acknowledgedDataLoss: true,
      confirmationVersion: '2026-08-delete-v1',
    });
  });

  it('omits an acknowledgement the account does not need', () => {
    expect(
      buildDeletionRequest({ accessEnds: true, appleBilling: true, dataLoss: true }, false),
    ).toEqual({
      acknowledgedAccessEnds: true,
      acknowledgedDataLoss: true,
      confirmationVersion: '2026-08-delete-v1',
    });
  });
});

const body: AccountDeletionRequest = {
  acknowledgedAccessEnds: true,
  acknowledgedDataLoss: true,
  confirmationVersion: '2026-08-delete-v1',
};

function dependencies(overrides: Partial<DeletionFlowDependencies> = {}): DeletionFlowDependencies {
  return {
    getAccessToken: () => 'access-token',
    reauthenticate: vi.fn(() => Promise.resolve(true)),
    request: vi.fn(() => Promise.resolve({ deletion: pending })),
    ...overrides,
  };
}

const staleProof = () =>
  new MobileApiError({ code: 'GAME_CENTER_REAUTH_REQUIRED', message: 'stale', retryable: true });

describe('submitAccountDeletion', () => {
  it('returns the pending state on the first success', async () => {
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    const deps = dependencies({ reauthenticate });

    expect(await submitAccountDeletion(deps, body)).toEqual({
      kind: 'ACCEPTED',
      deletion: pending,
    });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it('reauthenticates once when the Game Center proof has aged out', async () => {
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    const request = vi
      .fn<DeletionFlowDependencies['request']>()
      .mockRejectedValueOnce(staleProof())
      .mockResolvedValueOnce({ deletion: pending });

    const result = await submitAccountDeletion(dependencies({ reauthenticate, request }), body);

    expect(result).toEqual({ kind: 'ACCEPTED', deletion: pending });
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stops after one retry rather than looping on a stale proof', async () => {
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    const request = vi.fn<DeletionFlowDependencies['request']>().mockRejectedValue(staleProof());

    const result = await submitAccountDeletion(dependencies({ reauthenticate, request }), body);

    expect(result).toMatchObject({ kind: 'FAILED', reauthenticationNeeded: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it('never retries an error that is not about the proof age', async () => {
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    const request = vi
      .fn<DeletionFlowDependencies['request']>()
      .mockRejectedValue(
        new MobileApiError({ code: 'NETWORK_UNAVAILABLE', message: 'offline', retryable: true }),
      );

    const result = await submitAccountDeletion(dependencies({ reauthenticate, request }), body);

    expect(result).toMatchObject({ kind: 'FAILED', reauthenticationNeeded: false });
    expect(result).toHaveProperty('message', expect.stringContaining('Nothing was deleted'));
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('describeDeletionState', () => {
  it('counts the days left in the processing period', () => {
    expect(describeDeletionState(pending, now)).toContain('September 6, 2026');
    expect(describeDeletionState(pending, now)).toContain('30 days from now');
  });

  it('states the terminal outcomes plainly', () => {
    expect(describeDeletionState({ ...pending, status: 'PURGED' }, now)).toContain(
      'cannot be restored',
    );
    expect(
      describeDeletionState(
        { ...pending, cancelledAt: '2026-08-08T00:00:00.000Z', status: 'CANCELLED' },
        now,
      ),
    ).toContain('active again');
  });
});
