import {
  noDrawsAvailableDetailsSchema,
  unviewedReadingPendingDetailsSchema,
  type FortuneDrawResponse,
  type FortuneIntention,
  type NoDrawsAvailableDetails,
  type UnviewedReadingPendingDetails,
} from '@fortuneness/api-contracts';

import { MobileApiError } from '../auth/api-client';

export type DrawAttemptResult =
  | { kind: 'ALLOWANCE_EXHAUSTED'; details: NoDrawsAvailableDetails }
  | { kind: 'DRAW_ALREADY_ISSUED'; details: UnviewedReadingPendingDetails }
  | { kind: 'DRAW_ISSUED'; response: FortuneDrawResponse }
  | { kind: 'IGNORED_IN_FLIGHT' };

interface DrawAttemptDependencies {
  createUuid(): string;
  draw(
    accessToken: string,
    request: { intention: FortuneIntention },
    idempotencyKey: string,
  ): Promise<FortuneDrawResponse>;
}

interface RetainedAttempt {
  accountId: string;
  idempotencyKey: string;
  intention: FortuneIntention;
}

export class DrawAttemptController {
  private inFlight = false;
  private retainedAttempt: RetainedAttempt | undefined;

  constructor(private readonly dependencies: DrawAttemptDependencies) {}

  get retainedIntention(): FortuneIntention | undefined {
    return this.retainedAttempt?.intention;
  }

  reset(): void {
    this.retainedAttempt = undefined;
  }

  async execute(
    accountId: string,
    accessToken: string,
    intention: FortuneIntention,
  ): Promise<DrawAttemptResult> {
    if (this.inFlight) {
      return { kind: 'IGNORED_IN_FLIGHT' };
    }
    if (this.retainedAttempt?.accountId !== accountId) {
      this.retainedAttempt = undefined;
    }
    this.retainedAttempt ??= {
      accountId,
      idempotencyKey: this.dependencies.createUuid(),
      intention,
    };
    const attempt = this.retainedAttempt;
    this.inFlight = true;
    try {
      const response = await this.dependencies.draw(
        accessToken,
        { intention: attempt.intention },
        attempt.idempotencyKey,
      );
      this.retainedAttempt = undefined;
      return { kind: 'DRAW_ISSUED', response };
    } catch (error) {
      if (error instanceof MobileApiError && error.code === 'UNVIEWED_READING_PENDING') {
        const details = unviewedReadingPendingDetailsSchema.safeParse(error.details);
        if (details.success) {
          this.retainedAttempt = undefined;
          return { kind: 'DRAW_ALREADY_ISSUED', details: details.data };
        }
      }
      if (error instanceof MobileApiError && error.code === 'NO_DRAWS_AVAILABLE') {
        const details = noDrawsAvailableDetailsSchema.safeParse(error.details);
        if (details.success) {
          this.retainedAttempt = undefined;
          return { kind: 'ALLOWANCE_EXHAUSTED', details: details.data };
        }
      }
      if (!(error instanceof MobileApiError) || !error.retryable || !error.sameKeyRetrySafe) {
        this.retainedAttempt = undefined;
      }
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
}
