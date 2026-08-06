import { type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { publicEnvironment } from '@/config/public-environment';
import { spacing } from '@/theme/tokens';

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
  if (authentication.phase === 'AUTHENTICATED') {
    return children;
  }

  const copy = (() => {
    switch (authentication.phase) {
      case 'STARTING':
      case 'AUTHENTICATING':
        return {
          title: 'Opening your circle',
          message: 'Connecting securely with Game Center and your Fortuneness account.',
          retry: false,
        };
      case 'NONPERSISTENT_ID':
        return {
          title: 'Game Center is still preparing',
          message:
            'Game Center returned temporary player identifiers. Wait a moment, then try again; no account was created.',
          retry: true,
        };
      case 'DELETION_PENDING':
        return {
          title: 'Account deletion is pending',
          message:
            'Normal readings are paused while deletion is pending. Deletion status and cancellation controls will appear here when that phase is enabled.',
          retry: true,
        };
      case 'PURGED':
        return {
          title: 'This account was deleted',
          message:
            'The prior Fortuneness profile and its benefits cannot be restored or transferred. Try again to create a new empty profile for the current Game Center player.',
          retry: true,
        };
      case 'UNSUPPORTED':
        return {
          title: 'Development build required',
          message:
            'Game Center is unavailable in Expo Go. Open Fortuneness in its iOS development client.',
          retry: false,
        };
      case 'GAME_CENTER_BLOCKED':
        return {
          title: 'Sign in to Game Center',
          message:
            'Fortuneness uses your Game Center player to protect and sync your readings. Sign in under iOS Settings, then try again.',
          retry: true,
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
        {copy.retry ? (
          <AppButton
            label="Try Game Center again"
            onPress={() => {
              void authentication.retry();
            }}
          />
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
