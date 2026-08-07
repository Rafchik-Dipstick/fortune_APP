/**
 * On-device performance instrumentation.
 *
 * Phase 13 requires profiling startup, card reveal, collection scroll, memory
 * pressure, and background/foreground transitions on the oldest supported
 * device. That profiling session needs the app to say when those moments
 * happen; guessing them from a trace viewer is how a measurement ends up
 * describing the wrong span.
 *
 * Everything here stays on the device. Nothing is sent anywhere, nothing is
 * persisted, and no identifier, reading, or card is recorded — only a span
 * name and a duration. That is deliberate: the App Privacy worksheet declares
 * no analytics SDK and no crash reporter, and this must not quietly make that
 * declaration false. The recorder is a ring buffer an engineer reads during a
 * profiling run, not telemetry.
 */

export const performanceSpans = [
  'startup.moduleLoaded',
  'startup.firstScreenReady',
  'reveal.cardReady',
  'reveal.contentReachable',
  'collection.firstPageReady',
  'collection.pageAppended',
  'foreground.resumed',
] as const;

export type PerformanceSpan = (typeof performanceSpans)[number];

export type PerformanceEventName = PerformanceSpan | 'memoryWarning' | 'backgrounded';

export interface PerformanceSample {
  durationMs: number;
  span: PerformanceSpan;
}

export interface PerformanceSummary {
  count: number;
  maxMs: number;
  medianMs: number;
  worstMs: number;
}

/** Budgets for the oldest supported device, from `docs/phase13-mobile-performance-protocol.md`. */
export const performanceBudgetsMs: Readonly<Record<PerformanceSpan, number>> = {
  'collection.firstPageReady': 1_200,
  'collection.pageAppended': 600,
  'foreground.resumed': 800,
  'reveal.cardReady': 1_000,
  'reveal.contentReachable': 2_500,
  'startup.firstScreenReady': 2_500,
  'startup.moduleLoaded': 1_500,
};

const maximumSamplesPerSpan = 50;

export class PerformanceRecorder {
  readonly #marks = new Map<string, number>();
  readonly #samples = new Map<PerformanceSpan, number[]>();
  #backgroundedCount = 0;
  #memoryWarningCount = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Starts a span. Marking the same name again restarts it. `atMs` backdates
   * the mark, which startup needs: the launch instant is captured when the
   * module evaluates, well before any component can call this.
   */
  mark(name: string, atMs?: number): void {
    this.#marks.set(name, atMs ?? this.now());
  }

  /**
   * Closes a span opened by `mark`. Returns the duration, or undefined when
   * the opening mark never happened — a resumed reveal legitimately skips
   * steps, and a missing mark must not be reported as a zero-millisecond one.
   */
  measure(span: PerformanceSpan, fromMark: string): number | undefined {
    const startedAt = this.#marks.get(fromMark);
    if (startedAt === undefined) {
      return undefined;
    }
    const durationMs = this.now() - startedAt;
    this.record(span, durationMs);
    return durationMs;
  }

  record(span: PerformanceSpan, durationMs: number): void {
    const samples = this.#samples.get(span) ?? [];
    samples.push(durationMs);
    if (samples.length > maximumSamplesPerSpan) {
      samples.shift();
    }
    this.#samples.set(span, samples);
  }

  recordMemoryWarning(): void {
    this.#memoryWarningCount += 1;
  }

  recordBackgrounded(): void {
    this.#backgroundedCount += 1;
  }

  clearMark(name: string): void {
    this.#marks.delete(name);
  }

  summarize(span: PerformanceSpan): PerformanceSummary | undefined {
    const samples = this.#samples.get(span);
    if (samples === undefined || samples.length === 0) {
      return undefined;
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return {
      count: sorted.length,
      maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      medianMs: Math.round(sorted[middle] ?? 0),
      worstMs: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  }

  /** The whole report an engineer reads at the end of a profiling run. */
  report(): {
    backgroundedCount: number;
    memoryWarningCount: number;
    spans: { budgetMs: number; overBudget: boolean; span: PerformanceSpan }[];
  } {
    const spans = [];
    for (const span of performanceSpans) {
      const summary = this.summarize(span);
      if (summary === undefined) {
        continue;
      }
      const budgetMs = performanceBudgetsMs[span];
      spans.push({
        ...summary,
        budgetMs,
        overBudget: summary.medianMs > budgetMs,
        span,
      });
    }
    return {
      backgroundedCount: this.#backgroundedCount,
      memoryWarningCount: this.#memoryWarningCount,
      spans,
    };
  }

  reset(): void {
    this.#marks.clear();
    this.#samples.clear();
    this.#backgroundedCount = 0;
    this.#memoryWarningCount = 0;
  }
}
