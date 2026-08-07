import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';

import { useAuthentication } from '../auth/authentication';
import { registerAccountDataClearer } from './account-cleanup';
import { AccountArchiveStore } from './archive-store';
import { AccountReadingStore, initializeReadingDatabase } from './reading-store';

interface LocalDataContextValue {
  accountTransitionFailed: boolean;
  archiveStore: AccountArchiveStore;
  readyUserId: string | undefined;
  readingStore: AccountReadingStore;
  retryAccountTransition(): void;
}

const LocalDataContext = createContext<LocalDataContextValue | undefined>(undefined);

export function LocalDataProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="fortuneness-local.db" onInit={initializeReadingDatabase}>
      <LocalDataRuntime>{children}</LocalDataRuntime>
    </SQLiteProvider>
  );
}

function LocalDataRuntime({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  const database = useSQLiteContext();
  const readingStore = useMemo(() => new AccountReadingStore(database), [database]);
  const archiveStore = useMemo(() => new AccountArchiveStore(database), [database]);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, staleTime: 30_000 },
          mutations: { retry: false },
        },
      }),
  );
  const [readyUserId, setReadyUserId] = useState<string>();
  const [accountTransitionFailed, setAccountTransitionFailed] = useState(false);
  const [accountTransitionAttempt, setAccountTransitionAttempt] = useState(0);
  const previousUserId = useRef<string | undefined>(undefined);
  const authenticatedUserId =
    authentication.phase === 'AUTHENTICATED' ? authentication.session?.user.id : undefined;

  useEffect(
    () =>
      registerAccountDataClearer(async (userId) => {
        queryClient.clear();
        if (userId !== undefined) {
          await readingStore.purgeAccount(userId);
        }
      }),
    [queryClient, readingStore],
  );

  useEffect(() => {
    const controller = new AbortController();
    const previous = previousUserId.current;
    setReadyUserId(undefined);
    setAccountTransitionFailed(false);
    queryClient.clear();

    // Leaving AUTHENTICATED is not leaving the account. A refresh in flight, a
    // dropped connection, or a re-authentication all land here with no user id,
    // and purging on that would delete the archive of the account about to come
    // back. Only a *different* signed-in account displaces the stored one;
    // sign-out and deletion clear it explicitly through
    // `clearAllLocalAccountData` -> the clearer registered above.
    if (authenticatedUserId === undefined) {
      return () => {
        controller.abort();
      };
    }

    void (async () => {
      try {
        if (previous !== undefined && previous !== authenticatedUserId) {
          await readingStore.purgeAccount(previous);
        }
        if (controller.signal.aborted) {
          return;
        }
        previousUserId.current = authenticatedUserId;
        setReadyUserId(authenticatedUserId);
      } catch {
        if (!controller.signal.aborted) {
          setAccountTransitionFailed(true);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [accountTransitionAttempt, authenticatedUserId, queryClient, readingStore]);

  const value = useMemo(
    () => ({
      accountTransitionFailed,
      archiveStore,
      readingStore,
      readyUserId,
      retryAccountTransition: () => {
        setAccountTransitionAttempt((attempt) => attempt + 1);
      },
    }),
    [accountTransitionFailed, archiveStore, readingStore, readyUserId],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <LocalDataContext.Provider value={value}>{children}</LocalDataContext.Provider>
    </QueryClientProvider>
  );
}

export function useLocalData(): LocalDataContextValue {
  const value = useContext(LocalDataContext);
  if (value === undefined) {
    throw new Error('useLocalData must be used inside LocalDataProvider.');
  }
  return value;
}
