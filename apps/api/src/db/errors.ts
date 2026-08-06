export type DatabaseErrorKind =
  | 'CHECK_CONSTRAINT'
  | 'FOREIGN_KEY_CONSTRAINT'
  | 'NOT_FOUND'
  | 'TRANSACTION_CONFLICT'
  | 'UNAVAILABLE'
  | 'UNIQUE_CONSTRAINT';

type UnknownRecord = Record<string, unknown>;

const prismaErrorKinds = {
  P1001: 'UNAVAILABLE',
  P1002: 'UNAVAILABLE',
  P1017: 'UNAVAILABLE',
  P2002: 'UNIQUE_CONSTRAINT',
  P2003: 'FOREIGN_KEY_CONSTRAINT',
  P2004: 'CHECK_CONSTRAINT',
  P2025: 'NOT_FOUND',
  P2034: 'TRANSACTION_CONFLICT',
} as const satisfies Readonly<Record<string, DatabaseErrorKind>>;

const postgresErrorKinds = {
  '23P01': 'CHECK_CONSTRAINT',
  '23503': 'FOREIGN_KEY_CONSTRAINT',
  '23505': 'UNIQUE_CONSTRAINT',
  '23514': 'CHECK_CONSTRAINT',
  '40001': 'TRANSACTION_CONFLICT',
  '40P01': 'TRANSACTION_CONFLICT',
  '55P03': 'TRANSACTION_CONFLICT',
} as const satisfies Readonly<Record<string, DatabaseErrorKind>>;

export class DatabaseError extends Error {
  readonly kind: DatabaseErrorKind;
  readonly retryable: boolean;

  constructor(kind: DatabaseErrorKind, cause: unknown) {
    super(`Database operation failed: ${kind}.`, { cause });
    this.name = 'DatabaseError';
    this.kind = kind;
    this.retryable = kind === 'TRANSACTION_CONFLICT' || kind === 'UNAVAILABLE';
  }
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function findErrorCode(value: unknown, depth = 0): string | undefined {
  if (!isUnknownRecord(value) || depth > 4) {
    return undefined;
  }

  for (const field of ['code', 'originalCode', 'sqlState'] as const) {
    const candidate = value[field];
    if (typeof candidate === 'string') {
      if (candidate in prismaErrorKinds || candidate in postgresErrorKinds) {
        return candidate;
      }
    }
  }

  for (const field of ['cause', 'meta', 'driverAdapterError'] as const) {
    const nestedCode = findErrorCode(value[field], depth + 1);
    if (nestedCode !== undefined) {
      return nestedCode;
    }
  }

  return undefined;
}

export function mapDatabaseError(error: unknown): DatabaseError | undefined {
  if (error instanceof DatabaseError) {
    return error;
  }

  const code = findErrorCode(error);
  if (code === undefined) {
    return undefined;
  }

  const kind =
    code in prismaErrorKinds
      ? prismaErrorKinds[code as keyof typeof prismaErrorKinds]
      : postgresErrorKinds[code as keyof typeof postgresErrorKinds];
  return new DatabaseError(kind, error);
}

export function isRetryableTransactionError(error: unknown): boolean {
  return mapDatabaseError(error)?.kind === 'TRANSACTION_CONFLICT';
}
