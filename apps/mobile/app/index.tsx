import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { FortuneAllowanceState, FortuneIntention } from '@fortuneness/api-contracts';

import { MobileApiError } from '@/auth/api-client';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { IntentionSelector } from '@/components/intention-selector';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { useFortuneRitual } from '@/fortune/fortune-ritual';
import { usePerformance } from '@/observability/performance-provider';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, spacing } from '@/theme/tokens';

const intentionLabels: Record<FortuneIntention, string> = {
  GENERAL: 'General',
  LOVE: 'Love',
  WORK: 'Work',
  GROWTH: 'Growth',
};

function formatNextReset(state: FortuneAllowanceState): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      timeZone: state.accountTimeZone,
      timeZoneName: 'short',
    }).format(new Date(state.nextResetAt));
  } catch {
    return state.nextResetAt;
  }
}

/**
 * States the spend order plainly so a subscriber can see that Oracle+ readings
 * are used before any pack credit they bought separately.
 */
function allowanceOrderNote(state: FortuneAllowanceState): string {
  if (state.subscription.status === 'GRACE_PERIOD') {
    return 'Oracle+ is in a billing grace period and still grants its daily readings. Pack credits are spent last.';
  }
  if (state.subscription.entitled) {
    return 'Free, then Oracle+, then pack credits — in that order.';
  }
  return state.spendablePackCredits > 0
    ? 'The free reading is spent before any pack credit.'
    : 'The free daily reading is always included.';
}

function drawFailureMessage(error: Error, retainedIntention: FortuneIntention | undefined): string {
  if (error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE') {
    return retainedIntention === undefined
      ? 'A connection is required to draw. Nothing was consumed.'
      : `The ${intentionLabels[retainedIntention]} request is saved for an exact safe retry. Nothing will be doubled.`;
  }
  return 'The draw could not be completed. Nothing new will be requested until you try again.';
}

export default function OracleScreen() {
  const router = useRouter();
  const ritual = useFortuneRitual();
  const performance = usePerformance();
  const { isRegular, oracleCardWidth } = useAdaptiveLayout();
  const [intention, setIntention] = useState<FortuneIntention>('GENERAL');
  const startupRecorded = useRef(false);

  useEffect(() => {
    // Startup ends when the Oracle can actually be used, not when the first
    // pixel lands, so this waits for authoritative allowance state.
    if (!startupRecorded.current && !ritual.isStateLoading) {
      startupRecorded.current = true;
      performance.measure('startup.firstScreenReady', 'startup.launched');
    }
  }, [performance, ritual.isStateLoading]);

  const openReveal = () => {
    router.push('/reveal');
  };
  const requestDraw = async () => {
    const result = await ritual.requestDraw(intention);
    if (result === 'REVEAL_READY') {
      openReveal();
    }
  };
  const pending = ritual.pendingReveal;
  const allowance = ritual.allowance;
  const availableDraws = allowance?.availableDraws ?? 0;
  const exhausted = allowance !== undefined && availableDraws === 0;

  return (
    <Screen>
      <PageHeader
        actions={
          <>
            <AppButton
              compact
              label="Collection"
              onPress={() => {
                router.push('/collection');
              }}
              variant="quiet"
            />
            <View style={styles.shopAction}>
              <AppButton
                accessibilityLabel={
                  exhausted ? 'Shop. Optional ways to draw more are available.' : 'Shop'
                }
                compact
                label="Shop"
                onPress={() => {
                  router.push('/shop');
                }}
                variant="quiet"
              />
              {exhausted ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.shopDot}
                />
              ) : null}
            </View>
            <AppButton
              compact
              label="Settings"
              onPress={() => {
                router.push('/settings');
              }}
              variant="quiet"
            />
          </>
        }
        eyebrow="Daily ritual"
        title="Oracle"
      />

      {pending !== undefined ? (
        <>
          <StatusBanner
            message={
              ritual.stateError === undefined
                ? 'It is already saved. Continue without drawing or consuming anything again.'
                : 'Your saved reading is available on this device while the Oracle reconnects.'
            }
            title="Continue your reading"
          />
          <View style={styles.resumePanel}>
            <TarotCard
              accessibilityLabel="Continue your saved tarot reading."
              face="down"
              onPress={openReveal}
              width={oracleCardWidth}
            />
            <AppButton label="Continue your reading" onPress={openReveal} />
          </View>
        </>
      ) : ritual.isStateLoading ? (
        <LoadingSkeleton />
      ) : ritual.stateError !== undefined ? (
        <ErrorState
          message={
            ritual.stateError instanceof MobileApiError &&
            ritual.stateError.code === 'NETWORK_UNAVAILABLE'
              ? 'A connection is required for a new draw. No allowance was consumed.'
              : 'The authoritative Oracle state could not be loaded. No allowance was consumed.'
          }
          onRetry={() => {
            void ritual.retryState();
          }}
          title="Oracle is temporarily unavailable"
        />
      ) : allowance !== undefined ? (
        <>
          <StatusBanner
            message={
              exhausted
                ? `Your next daily reflection is available ${formatNextReset(allowance)}.`
                : `Next daily reset ${formatNextReset(allowance)}.`
            }
            title={
              exhausted
                ? 'Your daily ritual is complete'
                : `${String(availableDraws)} ${availableDraws === 1 ? 'reflection is' : 'reflections are'} ready`
            }
          />

          <View style={[styles.oracle, isRegular ? styles.oracleRegular : undefined]}>
            <View style={styles.cardColumn}>
              <TarotCard
                accessibilityLabel={
                  exhausted ? 'No tarot draws are currently available.' : 'Draw a tarot card.'
                }
                face="down"
                {...(exhausted || ritual.isDrawing
                  ? {}
                  : {
                      onPress: () => {
                        void requestDraw();
                      },
                    })}
                width={oracleCardWidth}
              />
              <AppButton
                disabled={exhausted || ritual.isDrawing}
                label={
                  ritual.isDrawing
                    ? 'Waiting for your card…'
                    : ritual.retainedIntention === undefined
                      ? 'Draw your card'
                      : `Retry ${intentionLabels[ritual.retainedIntention]} draw`
                }
                onPress={() => {
                  void requestDraw();
                }}
              />
              {exhausted ? (
                <AppButton
                  label="See optional ways to draw more"
                  onPress={() => {
                    router.push('/shop');
                  }}
                  variant="quiet"
                />
              ) : null}
            </View>

            <Surface style={styles.ritualPanel}>
              <AppText color="gold" variant="caption">
                Set an intention
              </AppText>
              <AppText accessibilityRole="header" variant="headline">
                What would you like to notice today?
              </AppText>
              <AppText color="textMuted">
                Choose a focus or keep General. Your reading offers reflection, not certainty.
              </AppText>
              <IntentionSelector onChange={setIntention} value={intention} />
              <View style={styles.allowance}>
                <AppText variant="label">
                  {String(allowance.freeRemaining)} free · {String(allowance.subscriptionRemaining)}{' '}
                  Oracle+ · {String(allowance.spendablePackCredits)} pack
                </AppText>
                <AppText color="textMuted" variant="caption">
                  {allowanceOrderNote(allowance)}
                </AppText>
                <AppText color="textMuted" variant="caption">
                  Account day: {allowance.accountTimeZone}
                </AppText>
              </View>
              {ritual.drawError !== undefined ? (
                <AppText accessibilityLiveRegion="assertive" color="danger" variant="caption">
                  {drawFailureMessage(ritual.drawError, ritual.retainedIntention)}
                </AppText>
              ) : null}
              {ritual.isRefreshing ? (
                <AppText color="textMuted" variant="caption">
                  Refreshing authoritative allowance…
                </AppText>
              ) : null}
            </Surface>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shopAction: {
    justifyContent: 'center',
  },
  // Quiet availability hint only; never a flashing badge or countdown.
  shopDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.goldMuted,
  },
  oracle: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingTop: spacing.xl,
  },
  oracleRegular: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardColumn: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  resumePanel: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xl,
  },
  ritualPanel: {
    width: '100%',
    maxWidth: 520,
  },
  allowance: {
    gap: spacing.xxs,
    paddingTop: spacing.sm,
  },
});
