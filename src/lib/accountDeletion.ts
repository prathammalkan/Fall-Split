export interface AccountDeletionResult {
  error: Error | null;
  partialFailure?: boolean;
}

export interface AccountDeletionOperations {
  anonymizeProfile: () => Promise<AccountDeletionResult>;
  clearOfflineQueue: () => Promise<AccountDeletionResult>;
  deleteAuthUser: () => Promise<AccountDeletionResult>;
  signOut: () => Promise<AccountDeletionResult>;
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export async function completeAccountDeletion(
  operations: AccountDeletionOperations
): Promise<AccountDeletionResult> {
  let anonymizeResult: AccountDeletionResult;
  try {
    anonymizeResult = await operations.anonymizeProfile();
  } catch (error) {
    return { error: normalizeError(error, 'Account anonymization failed') };
  }
  if (anonymizeResult.error) return anonymizeResult;

  let queueClearError: Error | null;
  try {
    queueClearError = (await operations.clearOfflineQueue()).error;
  } catch (error) {
    queueClearError = normalizeError(error, 'Offline expense data could not be cleared');
  }

  let deletionError: Error | null;
  try {
    deletionError = (await operations.deleteAuthUser()).error;
  } catch (error) {
    deletionError = normalizeError(error, 'Auth-user deletion failed');
  }

  if (deletionError) {
    const localDataWarning = queueClearError
      ? ` Local offline expense data could not be cleared: ${queueClearError.message}.`
      : '';
    return {
      error: new Error(
        `Profile data was anonymized, but account deletion could not be completed: ${deletionError.message}.${localDataWarning}`
      ),
      partialFailure: true,
    };
  }

  let signOutError: Error | null;
  try {
    signOutError = (await operations.signOut()).error;
  } catch (error) {
    signOutError = normalizeError(error, 'Sign-out failed');
  }

  if (signOutError) {
    const localDataWarning = queueClearError
      ? ` Local offline expense data could not be cleared: ${queueClearError.message}.`
      : '';
    return {
      error: new Error(
        `Auth-user deletion completed, but sign-out failed: ${signOutError.message}.${localDataWarning}`
      ),
      partialFailure: true,
    };
  }
  if (queueClearError) {
    return {
      error: new Error(
        `Auth-user deletion completed, but local offline expense data could not be cleared: ${queueClearError.message}. Clear this site's data before another person uses this device.`
      ),
      partialFailure: true,
    };
  }
  return { error: null };
}
