import type { AllowanceSource, FortuneIntention } from '@fortuneness/api-contracts';

import type { FortuneDrawErrorCode } from '../fortune/draw.js';
import type { ApiLogger } from '../logging/logger.js';

export interface FortuneDrawTelemetry {
  recordIssued(event: { allowanceSource: AllowanceSource; intention: FortuneIntention }): void;
  recordRejected(code: FortuneDrawErrorCode | 'VALIDATION_FAILED'): void;
}

export class LoggerFortuneDrawTelemetry implements FortuneDrawTelemetry {
  constructor(private readonly logger: ApiLogger) {}

  recordIssued(event: { allowanceSource: AllowanceSource; intention: FortuneIntention }): void {
    this.logger.info(
      {
        allowanceSource: event.allowanceSource,
        event: 'fortune_draw_issued',
        intention: event.intention,
      },
      'fortune draw issued',
    );
  }

  recordRejected(code: FortuneDrawErrorCode | 'VALIDATION_FAILED'): void {
    this.logger.info(
      {
        code,
        event: 'fortune_draw_rejected',
      },
      'fortune draw rejected',
    );
  }
}
