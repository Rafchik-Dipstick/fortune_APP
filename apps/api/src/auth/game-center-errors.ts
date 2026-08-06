export type GameCenterVerificationErrorCode =
  'BUNDLE_MISMATCH' | 'INVALID_PROOF' | 'KEY_UNAVAILABLE' | 'NONPERSISTENT_ID' | 'PROOF_EXPIRED';

export class GameCenterVerificationError extends Error {
  readonly code: GameCenterVerificationErrorCode;

  constructor(code: GameCenterVerificationErrorCode, cause?: unknown) {
    super(`Game Center verification failed: ${code}.`, { cause });
    this.name = 'GameCenterVerificationError';
    this.code = code;
  }
}
