import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Crypto from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FortuneAllowanceState,
  FortuneIntention,
  FortuneStateResponse,
} from '@fortuneness/api-contracts';

import { useAuthentication } from '../auth/authentication';
import {
  drawFortune,
  getFortuneState,
  markFortuneViewed,
  MobileApiError,
} from '../auth/api-client';
import { useLocalData } from '../local-data/local-data';
import { reconcilePendingReveal, type PendingReveal } from '../local-data/reading-store';
import { DrawAttemptController } from './draw-attempt';
import { useExperienceFeedback } from '../feedback/experience-feedback';

export type DrawUiResult = 'FAILED' | 'IGNORED' | 'REVEAL_READY';

interface FortuneRitualContextValue {
  acknowledgementAcceptedDrawId: string | undefined;
  acknowledgementError: Error | undefined;
  allowance: FortuneAllowanceState | undefined;
  drawError: Error | undefined;
  isAcknowledging: boolean;
  isDrawing: boolean;
  isRefreshing: boolean;
  isStateLoading: boolean;
  pendingReveal: PendingReveal | undefined;
  retainedIntention: FortuneIntention | undefined;
  stateError: Error | undefined;
  acknowledgeContentReachable: (drawId: string) => void;
  markCardRevealed: (drawId: string) => Promise<void>;
  requestDraw: (intention: FortuneIntention) => Promise<DrawUiResult>;
  retryState: () => Promise<void>;
}

const FortuneRitualContext = createContext<FortuneRitualContextValue | undefined>(undefined);

export const fortuneStateQueryKey = (accountId: string) => ['fortune', 'state', accountId] as const;

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('The fortune ritual could not be completed.', { cause: error });
}

export function FortuneRitualProvider({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  const localData = useLocalData();
  const feedback = useExperienceFeedback();
  const queryClient = useQueryClient();
  if (authentication.phase !== 'AUTHENTICATED' || authentication.session === undefined) {
    throw new Error('FortuneRitualProvider requires an authenticated session.');
  }
  const session = authentication.session;
  const accountId = session.user.id;
  const [pendingReveal, setPendingReveal] = useState<PendingReveal>();
  const [localPendingLoaded, setLocalPendingLoaded] = useState(false);
  const [reconciledAt, setReconciledAt] = useState(0);
  const [persistenceError, setPersistenceError] = useState<Error>();
  const [drawError, setDrawError] = useState<Error>();
  const [isDrawing, setIsDrawing] = useState(false);
  const [retainedIntention, setRetainedIntention] = useState<FortuneIntention>();
  const [acknowledgementAcceptedDrawId, setAcknowledgementAcceptedDrawId] = useState<string>();
  const drawInFlight = useRef(false);
  const drawController = useMemo(
    () =>
      new DrawAttemptController({
        createUuid: Crypto.randomUUID,
        draw: drawFortune,
      }),
    [],
  );

  const stateQuery = useQuery({
    queryKey: fortuneStateQueryKey(accountId),
    queryFn: () => getFortuneState(session.accessToken),
  });

  useEffect(() => {
    const controller = new AbortController();
    drawController.reset();
    drawInFlight.current = false;
    setDrawError(undefined);
    setIsDrawing(false);
    setLocalPendingLoaded(false);
    setPendingReveal(undefined);
    setPersistenceError(undefined);
    setReconciledAt(0);
    setRetainedIntention(undefined);
    setAcknowledgementAcceptedDrawId(undefined);

    void localData.readingStore
      .loadPendingReveal(accountId)
      .then((pending) => {
        if (!controller.signal.aborted) {
          setPendingReveal(pending);
          setLocalPendingLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPersistenceError(asError(error));
          setLocalPendingLoaded(true);
        }
      });

    return () => {
      controller.abort();
    };
  }, [accountId, drawController, localData.readingStore]);

  useEffect(() => {
    if (stateQuery.data === undefined || !localPendingLoaded) {
      return;
    }
    const controller = new AbortController();
    const updateTime = stateQuery.dataUpdatedAt;
    void reconcilePendingReveal(localData.readingStore, accountId, stateQuery.data.unviewedDraw)
      .then((pending) => {
        if (!controller.signal.aborted) {
          setPendingReveal(pending);
          setPersistenceError(undefined);
          setReconciledAt(updateTime);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPersistenceError(asError(error));
        }
      });
    return () => {
      controller.abort();
    };
  }, [
    accountId,
    localData.readingStore,
    localPendingLoaded,
    stateQuery.data,
    stateQuery.dataUpdatedAt,
  ]);

  const requestDraw = useCallback(
    async (intention: FortuneIntention): Promise<DrawUiResult> => {
      if (drawInFlight.current || pendingReveal !== undefined) {
        return pendingReveal === undefined ? 'IGNORED' : 'REVEAL_READY';
      }
      drawInFlight.current = true;
      setDrawError(undefined);
      setIsDrawing(true);
      try {
        const result = await drawController.execute(accountId, session.accessToken, intention);
        if (result.kind === 'IGNORED_IN_FLIGHT') {
          return 'IGNORED';
        }
        if (result.kind === 'ALLOWANCE_EXHAUSTED') {
          queryClient.setQueryData<FortuneStateResponse>(fortuneStateQueryKey(accountId), {
            state: result.details.state,
            unviewedDraw: null,
          });
          setRetainedIntention(undefined);
          return 'FAILED';
        }
        const response =
          result.kind === 'DRAW_ISSUED'
            ? result.response
            : { draw: result.details.unviewedDraw, state: result.details.state };
        await localData.readingStore.savePendingReveal(accountId, response.draw);
        feedback.drawIssued();
        const pending = { draw: response.draw, step: 'ISSUED' as const };
        setAcknowledgementAcceptedDrawId(undefined);
        setPendingReveal(pending);
        queryClient.setQueryData<FortuneStateResponse>(fortuneStateQueryKey(accountId), {
          state: response.state,
          unviewedDraw: response.draw,
        });
        setRetainedIntention(undefined);
        return 'REVEAL_READY';
      } catch (error) {
        setDrawError(asError(error));
        setRetainedIntention(drawController.retainedIntention);
        return 'FAILED';
      } finally {
        drawInFlight.current = false;
        setIsDrawing(false);
      }
    },
    [
      accountId,
      drawController,
      feedback,
      localData.readingStore,
      pendingReveal,
      queryClient,
      session.accessToken,
    ],
  );

  const acknowledgement = useMutation({
    mutationKey: ['fortune', 'viewed', accountId],
    mutationFn: async (pending: PendingReveal) => {
      await localData.readingStore.advancePendingReveal(
        accountId,
        pending.draw.id,
        'CONTENT_REACHABLE',
      );
      setPendingReveal((current) =>
        current?.draw.id === pending.draw.id ? { ...current, step: 'CONTENT_REACHABLE' } : current,
      );
      const response = await markFortuneViewed(session.accessToken, pending.draw.id);
      await localData.readingStore.completeReveal(accountId, response.draw);
      return response;
    },
    retry: (_failureCount, error) => error instanceof MobileApiError && error.retryable,
    retryDelay: (failureCount) => Math.min(1_000 * 2 ** failureCount, 30_000),
    onSuccess: (response) => {
      setAcknowledgementAcceptedDrawId(response.draw.id);
      setPendingReveal(undefined);
      queryClient.setQueryData<FortuneStateResponse>(fortuneStateQueryKey(accountId), (current) =>
        current === undefined
          ? undefined
          : {
              state: current.state,
              unviewedDraw: null,
            },
      );
      void queryClient.invalidateQueries({ queryKey: fortuneStateQueryKey(accountId) });
      void queryClient.invalidateQueries({ queryKey: ['fortune', 'history', accountId] });
      void queryClient.invalidateQueries({ queryKey: ['collection', 'summary', accountId] });
      void queryClient.invalidateQueries({ queryKey: ['collection', 'card', accountId] });
      void queryClient.invalidateQueries({ queryKey: ['archive', 'sync-state', accountId] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: fortuneStateQueryKey(accountId) });
    },
  });

  const markCardRevealed = useCallback(
    async (drawId: string) => {
      if (pendingReveal?.draw.id !== drawId || pendingReveal.step !== 'ISSUED') {
        return;
      }
      try {
        await localData.readingStore.advancePendingReveal(accountId, drawId, 'CARD_REVEALED');
        setPendingReveal((current) =>
          current?.draw.id === drawId && current.step === 'ISSUED'
            ? { ...current, step: 'CARD_REVEALED' }
            : current,
        );
      } catch (error) {
        setPersistenceError(asError(error));
      }
    },
    [accountId, localData.readingStore, pendingReveal],
  );

  const acknowledgeContentReachable = useCallback(
    (drawId: string) => {
      if (pendingReveal?.draw.id !== drawId || acknowledgement.isPending) {
        return;
      }
      acknowledgement.mutate(pendingReveal);
    },
    [acknowledgement, pendingReveal],
  );

  const retryState = useCallback(async () => {
    setPersistenceError(undefined);
    await stateQuery.refetch();
  }, [stateQuery]);

  const stateIsReconciled =
    stateQuery.data === undefined || stateQuery.dataUpdatedAt === reconciledAt;
  const value = useMemo<FortuneRitualContextValue>(
    () => ({
      acknowledgementError:
        acknowledgement.error === null ? undefined : asError(acknowledgement.error),
      acknowledgeContentReachable,
      acknowledgementAcceptedDrawId,
      allowance: stateQuery.data?.state,
      drawError,
      isAcknowledging: acknowledgement.isPending,
      isDrawing,
      isRefreshing: stateQuery.isFetching && !stateQuery.isPending,
      isStateLoading: !localPendingLoaded || stateQuery.isPending || !stateIsReconciled,
      markCardRevealed,
      pendingReveal,
      requestDraw,
      retainedIntention,
      retryState,
      stateError:
        persistenceError ?? (stateQuery.error === null ? undefined : asError(stateQuery.error)),
    }),
    [
      acknowledgeContentReachable,
      acknowledgementAcceptedDrawId,
      acknowledgement.error,
      acknowledgement.isPending,
      drawError,
      isDrawing,
      localPendingLoaded,
      markCardRevealed,
      pendingReveal,
      persistenceError,
      requestDraw,
      retainedIntention,
      retryState,
      stateIsReconciled,
      stateQuery.data?.state,
      stateQuery.error,
      stateQuery.isFetching,
      stateQuery.isPending,
    ],
  );
  return <FortuneRitualContext.Provider value={value}>{children}</FortuneRitualContext.Provider>;
}

export function useFortuneRitual(): FortuneRitualContextValue {
  const value = useContext(FortuneRitualContext);
  if (value === undefined) {
    throw new Error('useFortuneRitual must be used inside FortuneRitualProvider.');
  }
  return value;
}
