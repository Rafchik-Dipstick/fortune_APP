import {
  type AccountDeletionRequest,
  type AccountDeletionResponse,
  type AccountDeletionState,
  type IapCallerState,
} from '@fortuneness/api-contracts';

import { MobileApiError } from '../auth/api-client';

/** The consequence summary the player is shown; the server records this. */
export const deletionConfirmationVersion = '2026-08-delete-v1';

export interface DeletionAcknowledgements {
  accessEnds: boolean;
  appleBilling: boolean;
  dataLoss: boolean;
}

export const emptyAcknowledgements: DeletionAcknowledgements = {
  accessEnds: false,
  appleBilling: false,
  dataLoss: false,
};

/**
 * Mirrors the server rule: the extra acknowledgement is required only when
 * Apple may still bill this account. Deleting the account never cancels an
 * App Store subscription, and only Apple can.
 */
export function requiresAppleBillingAcknowledgement(
  callerState: IapCallerState | undefined,
  now: Date,
): boolean {
  const subscription = callerState?.subscription;
  if (subscription === undefined) {
    // Without a verified state the safe assumption is that billing may
    // continue, so the acknowledgement is shown rather than skipped.
    return true;
  }
  const paidThrough = subscription.paidThrough === null ? null : new Date(subscription.paidThrough);
  return (
    subscription.entitled ||
    subscription.status === 'BILLING_RETRY' ||
    (paidThrough !== null && paidThrough > now)
  );
}

/**
 * Returns the request body only when every required box is ticked, so the
 * confirm control has one unambiguous enabled condition.
 */
export function buildDeletionRequest(
  acknowledgements: DeletionAcknowledgements,
  appleBillingRequired: boolean,
): AccountDeletionRequest | undefined {
  if (!acknowledgements.accessEnds || !acknowledgements.dataLoss) {
    return undefined;
  }
  if (appleBillingRequired && !acknowledgements.appleBilling) {
    return undefined;
  }
  return {
    confirmationVersion: deletionConfirmationVersion,
    acknowledgedAccessEnds: true,
    acknowledgedDataLoss: true,
    ...(appleBillingRequired ? { acknowledgedAppleBilling: true } : {}),
  };
}

export interface DeletionFlowDependencies {
  getAccessToken(): string;
  reauthenticate(): Promise<boolean>;
  request(accessToken: string, body: AccountDeletionRequest): Promise<AccountDeletionResponse>;
}

export type DeletionRequestOutcome =
  | { kind: 'ACCEPTED'; deletion: AccountDeletionState }
  | { kind: 'FAILED'; message: string; reauthenticationNeeded: boolean };

/**
 * Deletion needs a Game Center proof from the last 300 seconds. An ordinary
 * refresh deliberately keeps the original sign-in time, so a stale proof is
 * answered with one forced reauthentication and a single retry.
 */
export async function submitAccountDeletion(
  dependencies: DeletionFlowDependencies,
  body: AccountDeletionRequest,
): Promise<DeletionRequestOutcome> {
  try {
    return {
      kind: 'ACCEPTED',
      deletion: (await dependencies.request(dependencies.getAccessToken(), body)).deletion,
    };
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.code !== 'GAME_CENTER_REAUTH_REQUIRED') {
      return {
        kind: 'FAILED',
        message: deletionErrorMessage(error),
        reauthenticationNeeded: false,
      };
    }
    if (!(await dependencies.reauthenticate())) {
      return {
        kind: 'FAILED',
        message:
          'Deleting your account needs a fresh Game Center sign-in. Sign in under iOS Settings, then try again. Nothing was deleted.',
        reauthenticationNeeded: true,
      };
    }
    try {
      return {
        kind: 'ACCEPTED',
        deletion: (await dependencies.request(dependencies.getAccessToken(), body)).deletion,
      };
    } catch (retryError) {
      return {
        kind: 'FAILED',
        message: deletionErrorMessage(retryError),
        reauthenticationNeeded:
          retryError instanceof MobileApiError && retryError.code === 'GAME_CENTER_REAUTH_REQUIRED',
      };
    }
  }
}

const deletionMessages: Partial<Record<MobileApiError['code'], string>> = {
  ACCOUNT_DELETION_PENDING:
    'This account already has a deletion in progress. Reopen Fortuneness to see its status.',
  ACCOUNT_PURGED: 'This account has already been deleted and cannot be restored.',
  GAME_CENTER_REAUTH_REQUIRED:
    'Deleting your account needs a Game Center sign-in from the last five minutes. Nothing was deleted.',
  NETWORK_UNAVAILABLE: 'Deleting your account needs a connection. Nothing was deleted.',
};

export function deletionErrorMessage(error: unknown): string {
  const generic =
    'The deletion request could not be completed. Nothing was deleted; try again in a moment.';
  if (!(error instanceof MobileApiError)) {
    return generic;
  }
  // A validation failure is the server naming the acknowledgement that is
  // still missing, which is more useful than a generic sentence.
  return (
    deletionMessages[error.code] ?? (error.code === 'VALIDATION_FAILED' ? error.message : generic)
  );
}

export function cancellationErrorMessage(error: unknown): string {
  if (error instanceof MobileApiError && error.code === 'ACCOUNT_PURGED') {
    return 'The processing period has ended and this account has been deleted. It cannot be restored.';
  }
  if (error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE') {
    return 'Keeping your account needs a connection. The deletion is still scheduled; try again.';
  }
  return 'The deletion could not be cancelled right now. It is still scheduled; try again in a moment.';
}

/** Plain-language summary of where a pending deletion stands. */
export function describeDeletionState(deletion: AccountDeletionState, now: Date): string {
  if (deletion.status === 'PURGED') {
    return 'This account has been deleted. It cannot be restored.';
  }
  if (deletion.status === 'CANCELLED') {
    return 'The deletion was cancelled and this account is active again.';
  }
  const purgeAt = new Date(deletion.purgeAt);
  const days = Math.max(0, Math.ceil((purgeAt.getTime() - now.getTime()) / 86_400_000));
  const formatted = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(purgeAt);
  return days === 0
    ? `Your account is scheduled for deletion today (${formatted}). You can still keep it until the deletion runs.`
    : `Your account is scheduled for deletion on ${formatted}, ${String(days)} ${days === 1 ? 'day' : 'days'} from now. You can keep it any time before then.`;
}
