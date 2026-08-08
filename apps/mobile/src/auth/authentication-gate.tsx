import { type ReactNode } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Linking, StyleSheet, View } from 'react-native';

import { DeletionPendingPanel } from '@/account/deletion-pending';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { publicEnvironment } from '@/config/public-environment';
import { spacing } from '@/theme/tokens';
import { useLocalData } from '@/local-data/local-data';

import { useAuthentication } from './authentication';

function openExternalUrl(url: string): void {
  void Linking.openURL(url);
}

function PublicAccessLinks() {
  return (
    <View style={styles.links}>
      <AppButton
        compact
        label="Privacy Policy"
        onPress={() => {
          openExternalUrl(publicEnvironment.privacyUrl);
        }}
        variant="quiet"
      />
      <AppButton
        compact
        label="Terms of Use"
        onPress={() => {
          openExternalUrl(publicEnvironment.termsUrl);
        }}
        variant="quiet"
      />
      <AppButton
        compact
        label="Support"
        onPress={() => {
          openExternalUrl(publicEnvironment.supportUrl);
        }}
        variant="quiet"
      />
    </View>
  );
}

export function AuthenticationGate({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  const localData = useLocalData();
  if (
    authentication.phase === 'AUTHENTICATED' &&
    authentication.session?.user.id === localData.readyUserId
  ) {
    return children;
  }

  if (authentication.phase === 'AUTHENTICATED') {
    return (
      <Screen readingWidth>
        <View style={styles.container}>
          <AppText color="gold" variant="caption">
            Fortuneness
          </AppText>
          <AppText accessibilityRole="header" variant="title">
            {localData.accountTransitionFailed
              ? 'Your private circle is still locked'
              : 'Preparing your private circle'}
          </AppText>
          <AppText color="textMuted">
            {localData.accountTransitionFailed
              ? 'Local account data could not be prepared safely. Try again before opening your readings.'
              : 'Clearing any prior account cache before opening your readings.'}
          </AppText>
          {localData.accountTransitionFailed ? (
            <AppButton
              label="Try local preparation again"
              onPress={() => {
                localData.retryAccountTransition();
              }}
            />
          ) : (
            <LoadingSkeleton />
          )}
        </View>
      </Screen>
    );
  }

  const copy = (() => {
    switch (authentication.phase) {
      case 'STARTING':
      case 'AUTHENTICATING':
        return {
          title: 'Opening your circle',
          message: 'Connecting securely with your Fortuneness account.',
          retry: false,
        };
      case 'DELETION_PENDING':
        return {
          title: 'Account deletion is pending',
          message:
            'Readings are paused while the deletion is processing. You can still keep this account until the deletion runs.',
          retry: false,
        };
      case 'PURGED':
        return {
          title: 'This account was deleted',
          message:
            'The prior Fortuneness profile and its benefits cannot be restored or transferred. Sign in with Apple to create a new empty profile.',
          retry: true,
          appleButton: true,
        };
      case 'UNSUPPORTED':
        return {
          title: 'Development build required',
          message: 'Sign in with Apple is unavailable on this device or build.',
          retry: false,
        };
      case 'APPLE_SIGN_IN_REQUIRED':
        return {
          title: 'Sign in to Fortuneness',
          message: 'Use your Apple Account to protect and sync your readings across your devices.',
          retry: true,
          appleButton: true,
        };
      case 'ERROR':
        return {
          title: 'The connection is resting',
          message:
            'Your account could not be verified right now. Nothing was consumed; check your connection and try again.',
          retry: true,
        };
    }
  })();

  return (
    <Screen readingWidth>
      <View style={styles.container}>
        <AppText color="gold" variant="caption">
          Fortuneness
        </AppText>
        <AppText accessibilityRole="header" variant="title">
          {copy.title}
        </AppText>
        <AppText color="textMuted">{copy.message}</AppText>
        {authentication.phase === 'STARTING' || authentication.phase === 'AUTHENTICATING' ? (
          <LoadingSkeleton />
        ) : null}
        {authentication.phase === 'DELETION_PENDING' ? <DeletionPendingPanel /> : null}
        {copy.retry && 'appleButton' in copy && copy.appleButton ? (
          <AppleAuthentication.AppleAuthenticationButton
            accessibilityLabel="Sign in with Apple"
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            cornerRadius={12}
            onPress={() => {
              void authentication.retry();
            }}
            style={styles.appleButton}
          />
        ) : copy.retry ? (
          <AppButton
            label="Try again"
            onPress={() => {
              void authentication.retry();
            }}
          />
        ) : null}
        {/*
          A blocked gate is the one screen with no way to see why, and it is
          the screen a tester or a reviewer is most likely to be stuck on.
          Showing this only in development meant the builds that actually get
          stuck — TestFlight and App Review — were the ones that said nothing,
          and diagnosing them turned into guesswork against an empty server
          log. Nothing here is a secret: the environment and the API address
          are compiled into the binary already, and `failureDetail` carries a
          scrubbed reason rather than a response body.
        */}
        {copy.retry ? (
          <Surface>
            <AppText variant="label">Diagnostics</AppText>
            <AppText color="textMuted" variant="caption">
              {`phase ${authentication.phase}\nenv ${publicEnvironment.appEnvironment}\napi ${publicEnvironment.apiUrl}\nwhy ${authentication.failureDetail ?? '(no failure recorded)'}`}
            </AppText>
          </Surface>
        ) : null}
        <Surface>
          <AppText variant="label">A gentle reflection, never a certainty</AppText>
          <AppText color="textMuted" variant="caption">
            Fortuneness offers tarot-inspired reflections for entertainment and personal
            contemplation. It does not predict certain outcomes or provide medical, legal,
            financial, or mental-health advice.
          </AppText>
          <PublicAccessLinks />
        </Surface>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  appleButton: {
    width: '100%',
    height: 48,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
