import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { PerformanceRecorder, type PerformanceSpan } from './performance';

/**
 * Installs the on-device profiling boundary.
 *
 * The provider owns the three moments no screen can observe for itself:
 * how long the JavaScript bundle took to reach the first render, how long a
 * backgrounded app takes to become interactive again, and when iOS raises a
 * memory warning. Screens contribute their own spans through `usePerformance`.
 *
 * Nothing leaves the device. The report is written to the development console
 * only, so a release build carries the recorder but never speaks.
 */

interface PerformanceContextValue {
  clearMark: (name: string) => void;
  logReport: () => void;
  mark: (name: string, atMs?: number) => void;
  measure: (span: PerformanceSpan, fromMark: string) => number | undefined;
  record: (span: PerformanceSpan, durationMs: number) => void;
}

const PerformanceContext = createContext<PerformanceContextValue | undefined>(undefined);

/**
 * Captured at module evaluation, which is the earliest moment JavaScript can
 * observe. The gap between this and the first screen is the startup cost the
 * device profiling session cares about.
 */
const moduleLoadedAt = Date.now();

export function PerformanceProvider({ children }: { children: ReactNode }) {
  const recorderRef = useRef<PerformanceRecorder>(undefined);
  recorderRef.current ??= new PerformanceRecorder();
  const recorder = recorderRef.current;

  useEffect(() => {
    recorder.record('startup.moduleLoaded', Date.now() - moduleLoadedAt);
    // Backdated so the first screen measures from launch, not from mount.
    recorder.mark('startup.launched', moduleLoadedAt);
  }, [recorder]);

  useEffect(() => {
    let backgroundedAt: number | undefined;

    const stateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt ??= Date.now();
        recorder.recordBackgrounded();
        return;
      }
      if (state === 'active' && backgroundedAt !== undefined) {
        recorder.record('foreground.resumed', Date.now() - backgroundedAt);
        backgroundedAt = undefined;
      }
    });
    // iOS-only; the listener is harmless where the event never fires.
    const memorySubscription = AppState.addEventListener('memoryWarning', () => {
      recorder.recordMemoryWarning();
    });

    return () => {
      stateSubscription.remove();
      memorySubscription.remove();
    };
  }, [recorder]);

  const value = useMemo<PerformanceContextValue>(
    () => ({
      clearMark: (name) => {
        recorder.clearMark(name);
      },
      logReport: () => {
        if (__DEV__) {
          // eslint-disable-next-line no-console -- the profiling report is for the Metro console only.
          console.log('[fortuneness performance]', JSON.stringify(recorder.report(), null, 2));
        }
      },
      mark: (name, atMs) => {
        recorder.mark(name, atMs);
      },
      measure: (span, fromMark) => recorder.measure(span, fromMark),
      record: (span, durationMs) => {
        recorder.record(span, durationMs);
      },
    }),
    [recorder],
  );

  return <PerformanceContext.Provider value={value}>{children}</PerformanceContext.Provider>;
}

/**
 * Screens use this to contribute their own spans. It returns inert functions
 * when no provider is mounted so a screen rendered in isolation — in a test,
 * or in the art-review harness — never has to know about profiling.
 */
export function usePerformance(): PerformanceContextValue {
  return (
    useContext(PerformanceContext) ?? {
      clearMark: () => undefined,
      logReport: () => undefined,
      mark: () => undefined,
      measure: () => undefined,
      record: () => undefined,
    }
  );
}
