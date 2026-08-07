import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsumptionConsent } from '@fortuneness/api-contracts';

import { useAuthentication } from '../auth/authentication';
import { getConsumptionConsent, setConsumptionConsent } from '../auth/api-client';

/**
 * Version of the explanation the player is shown before deciding. Apple's
 * consumption information is only ever sent for accounts that granted this
 * exact version, so changing the copy requires a new decision.
 */
export const consumptionConsentVersion = '2026-08-consumption-v1';

export const consumptionConsentQueryKey = (accountId: string) =>
  ['account', 'consumption-consent', accountId] as const;

interface ConsumptionConsentControl {
  consent: ConsumptionConsent | undefined;
  isSaving: boolean;
  saveFailed: boolean;
  setGranted: (granted: boolean) => void;
}

export function useConsumptionConsent(): ConsumptionConsentControl {
  const authentication = useAuthentication();
  const queryClient = useQueryClient();
  const session = authentication.session;
  const accountId = session?.user.id ?? 'anonymous';
  const queryKey = consumptionConsentQueryKey(accountId);

  const consentQuery = useQuery({
    queryKey,
    queryFn: () => getConsumptionConsent(session?.accessToken ?? ''),
    enabled: session !== undefined,
  });

  const mutation = useMutation({
    mutationFn: (granted: boolean) =>
      setConsumptionConsent(session?.accessToken ?? '', {
        consentVersion: consumptionConsentVersion,
        granted,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  const setGranted = useCallback(
    (granted: boolean) => {
      mutation.mutate(granted);
    },
    [mutation],
  );

  return {
    consent: consentQuery.data,
    isSaving: mutation.isPending,
    saveFailed: mutation.isError,
    setGranted,
  };
}
