import { useCallback, useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { StyleSheet, View } from 'react-native';
import type { AccountDeletionState } from '@fortuneness/api-contracts';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Surface } from '@/components/surface';
import { spacing } from '@/theme/tokens';

import { cancelAccountDeletion, getAccountDeletionStatus } from '../auth/api-client';
import { useAuthentication } from '../auth/authentication';
import { cancellationErrorMessage, describeDeletionState } from './deletion-flow';

/**
 * Shown while an account is in its processing period. The scoped token that
 * reaches this panel is issued by authenticating again, and it can do nothing
 * beyond reading the status and cancelling — application access stays closed.
 */
export function DeletionPendingPanel() {
  const authentication = useAuthentication();
  const management = authentication.deletionManagement;
  const [deletion, setDeletion] = useState<AccountDeletionState | undefined>(management?.deletion);
  const [failure, setFailure] = useState<string>();
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    setDeletion(management?.deletion);
    setFailure(undefined);
  }, [management]);

  const token = management?.deletionManagementToken;

  const refresh = useCallback(() => {
    if (token === undefined || isWorking) {
      return;
    }
    setFailure(undefined);
    setIsWorking(true);
    void getAccountDeletionStatus(token)
      .then(setDeletion)
      .catch(() => {
        setFailure('The deletion status could not be read right now. Try again in a moment.');
      })
      .finally(() => {
        setIsWorking(false);
      });
  }, [isWorking, token]);

  const keepAccount = useCallback(() => {
    if (token === undefined || isWorking) {
      return;
    }
    setFailure(undefined);
    setIsWorking(true);
    void cancelAccountDeletion(token)
      .then((restored) => authentication.resumeAfterDeletionCancelled(restored))
      .catch((error: unknown) => {
        setFailure(cancellationErrorMessage(error));
      })
      .finally(() => {
        setIsWorking(false);
      });
  }, [authentication, isWorking, token]);

  if (management === undefined) {
    return (
      <Surface>
        <AppText variant="label">See the deletion status</AppText>
        <AppText color="textMuted" variant="caption">
          Sign in with Apple again to view the deletion status or keep this account. Signing in
          during the processing period does not restore access on its own.
        </AppText>
        <AppleAuthentication.AppleAuthenticationButton
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          cornerRadius={12}
          onPress={() => {
            void authentication.retry();
          }}
          style={styles.appleButton}
        />
      </Surface>
    );
  }

  return (
    <Surface>
      <AppText variant="label">Deletion status</AppText>
      <AppText color="textMuted">
        {deletion === undefined
          ? 'Reading the status…'
          : describeDeletionState(deletion, new Date())}
      </AppText>
      <View style={styles.actions}>
        <AppButton
          disabled={isWorking || deletion?.status !== 'PENDING'}
          label={isWorking ? 'Working…' : 'Keep my account'}
          onPress={keepAccount}
        />
        <AppButton
          compact
          disabled={isWorking}
          label="Refresh status"
          onPress={refresh}
          variant="quiet"
        />
      </View>
      <AppText color="textMuted" variant="caption">
        Deleting a Fortuneness account never cancels an App Store subscription. Cancel that in
        Settings › Apple Account › Subscriptions.
      </AppText>
      {failure === undefined ? null : (
        <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
          {failure}
        </AppText>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  appleButton: {
    width: '100%',
    height: 48,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
