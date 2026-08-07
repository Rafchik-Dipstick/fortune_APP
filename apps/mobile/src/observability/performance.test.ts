import { describe, expect, it } from 'vitest';

import { PerformanceRecorder, performanceBudgetsMs, performanceSpans } from './performance';

function createRecorder(): { advance: (ms: number) => void; recorder: PerformanceRecorder } {
  let nowMs = 1_000;
  return {
    advance: (ms) => {
      nowMs += ms;
    },
    recorder: new PerformanceRecorder(() => nowMs),
  };
}

describe('on-device performance recorder', () => {
  it('measures a span between a mark and its close', () => {
    const { advance, recorder } = createRecorder();
    recorder.mark('drawRequested');
    advance(420);

    expect(recorder.measure('reveal.cardReady', 'drawRequested')).toBe(420);
    expect(recorder.summarize('reveal.cardReady')).toMatchObject({ count: 1, medianMs: 420 });
  });

  it('reports nothing for a span whose opening mark never happened', () => {
    const { recorder } = createRecorder();

    expect(recorder.measure('reveal.cardReady', 'neverMarked')).toBeUndefined();
    expect(recorder.summarize('reveal.cardReady')).toBeUndefined();
  });

  it('restarts a span when the same mark is set again', () => {
    const { advance, recorder } = createRecorder();
    recorder.mark('drawRequested');
    advance(5_000);
    recorder.mark('drawRequested');
    advance(300);

    expect(recorder.measure('reveal.cardReady', 'drawRequested')).toBe(300);
  });

  it('forgets a cleared mark so a resumed flow cannot report a stale duration', () => {
    const { recorder } = createRecorder();
    recorder.mark('drawRequested');
    recorder.clearMark('drawRequested');

    expect(recorder.measure('reveal.cardReady', 'drawRequested')).toBeUndefined();
  });

  it('summarizes the median and the worst sample', () => {
    const { recorder } = createRecorder();
    for (const durationMs of [100, 900, 200, 300, 250]) {
      recorder.record('collection.pageAppended', durationMs);
    }

    expect(recorder.summarize('collection.pageAppended')).toEqual({
      count: 5,
      maxMs: 900,
      medianMs: 250,
      worstMs: 900,
    });
  });

  it('keeps the buffer bounded during a long profiling run', () => {
    const { recorder } = createRecorder();
    for (let index = 0; index < 200; index += 1) {
      recorder.record('collection.pageAppended', index);
    }

    expect(recorder.summarize('collection.pageAppended')?.count).toBe(50);
  });

  it('counts memory warnings and backgrounding without recording anything else', () => {
    const { recorder } = createRecorder();
    recorder.recordMemoryWarning();
    recorder.recordMemoryWarning();
    recorder.recordBackgrounded();

    expect(recorder.report()).toMatchObject({ backgroundedCount: 1, memoryWarningCount: 2 });
  });

  it('flags a span over its budget for the oldest supported device', () => {
    const { recorder } = createRecorder();
    recorder.record(
      'startup.firstScreenReady',
      performanceBudgetsMs['startup.firstScreenReady'] + 1,
    );
    recorder.record('reveal.cardReady', 10);

    const report = recorder.report();
    expect(
      report.spans.find((entry) => entry.span === 'startup.firstScreenReady')?.overBudget,
    ).toBe(true);
    expect(report.spans.find((entry) => entry.span === 'reveal.cardReady')?.overBudget).toBe(false);
  });

  it('omits spans that were never observed rather than reporting zeroes', () => {
    const { recorder } = createRecorder();
    recorder.record('reveal.cardReady', 10);

    expect(recorder.report().spans.map((entry) => entry.span)).toEqual(['reveal.cardReady']);
  });

  it('gives every declared span a budget', () => {
    for (const span of performanceSpans) {
      expect(performanceBudgetsMs[span]).toBeGreaterThan(0);
    }
  });

  it('records only a span name and a duration, never content', () => {
    const { recorder } = createRecorder();
    recorder.mark('drawRequested');
    recorder.record('reveal.contentReachable', 900);

    const serialized = JSON.stringify(recorder.report());
    expect(serialized).not.toContain('drawRequested');
    for (const key of ['userId', 'drawId', 'cardKey', 'headline', 'token']) {
      expect(serialized).not.toContain(key);
    }
  });

  it('clears everything on reset', () => {
    const { recorder } = createRecorder();
    recorder.record('reveal.cardReady', 10);
    recorder.recordMemoryWarning();
    recorder.reset();

    expect(recorder.report()).toEqual({
      backgroundedCount: 0,
      memoryWarningCount: 0,
      spans: [],
    });
  });
});
