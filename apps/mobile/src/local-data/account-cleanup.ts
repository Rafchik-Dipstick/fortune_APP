import { clearStoredCredentials, loadStoredCredentials } from '../auth/session-storage';

type AccountDataClearer = (userId: string | undefined) => Promise<void>;

let registeredClearer: AccountDataClearer | undefined;

function normalizeError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}

export function registerAccountDataClearer(clearer: AccountDataClearer): () => void {
  registeredClearer = clearer;
  return () => {
    if (registeredClearer === clearer) {
      registeredClearer = undefined;
    }
  };
}

export async function clearAllLocalAccountData(): Promise<void> {
  let userId: string | undefined;
  let credentialError: Error | undefined;
  try {
    userId = (await loadStoredCredentials())?.userId;
  } catch (error) {
    credentialError = normalizeError(error, 'Stored account credentials could not be read.');
  }
  try {
    await clearStoredCredentials();
  } catch (error) {
    credentialError ??= normalizeError(error, 'Stored account credentials could not be cleared.');
  }

  let accountDataError: Error | undefined;
  try {
    await registeredClearer?.(userId);
  } catch (error) {
    accountDataError = normalizeError(error, 'Local account data could not be cleared.');
  }

  if (credentialError !== undefined) {
    throw credentialError;
  }
  if (accountDataError !== undefined) {
    throw accountDataError;
  }
}
