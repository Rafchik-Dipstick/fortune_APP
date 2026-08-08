export type AppleIdentityVerificationErrorCode =
  'INVALID_TOKEN' | 'KEY_UNAVAILABLE' | 'TOKEN_EXPIRED';

export class AppleIdentityVerificationError extends Error {
  readonly code: AppleIdentityVerificationErrorCode;

  constructor(code: AppleIdentityVerificationErrorCode, cause?: unknown) {
    super(`Apple identity verification failed: ${code}.`, { cause });
    this.name = 'AppleIdentityVerificationError';
    this.code = code;
  }
}
