# Phase 13 mobile performance profiling protocol

Status: **INSTRUMENTED — NOT YET PROFILED** — the app records every span this protocol needs; the profiling runs themselves require a Mac, Xcode, and the oldest supported physical device, none of which exist in the current environment.

Owner: whoever holds the Mac and the device matrix
Specification gate: Phase 13 — "Profile mobile startup, card reveal, collection scroll, memory pressure, and background/foreground transitions on the oldest supported test device."

## Why the app is instrumented at all

A trace viewer can show that something took 1.8 seconds. It cannot tell you whether that span was "launch to a usable Oracle" or "launch to the first pixel", and those two numbers lead to different fixes. So the app names its own moments: `src/observability/performance.ts` records a span name and a duration, and nothing else.

Nothing leaves the device. There is no analytics SDK and no crash reporter, and the recorder is a bounded in-memory ring buffer that is never persisted and never transmitted. That is what keeps the App Privacy answers for Product Interaction and Crash/Performance Data honest. The recorder exists so a person holding the device can read a report, not so the app can send one.

## Spans and budgets

Budgets are for the **oldest supported device** — the slowest hardware the app claims to support — under a cold launch on a warm network. A faster device beating a budget proves nothing.

| Span                        | Measures                                                                              | Budget  |
| --------------------------- | ------------------------------------------------------------------------------------- | ------- |
| `startup.moduleLoaded`      | Module evaluation to the first provider mount                                         | 1500 ms |
| `startup.firstScreenReady`  | Launch to a usable Oracle, meaning authoritative allowance state has arrived          | 2500 ms |
| `reveal.cardReady`          | Draw accepted to the card face being on screen                                        | 1000 ms |
| `reveal.contentReachable`   | Draw accepted to headline, message, action, and affirmation being VoiceOver-reachable | 2500 ms |
| `collection.firstPageReady` | Opening Collection to the first page of readings                                      | 1200 ms |
| `collection.pageAppended`   | Requesting the next page to it being appended                                         | 600 ms  |
| `foreground.resumed`        | Returning from background to interactive                                              | 800 ms  |

A resumed reveal deliberately records nothing: it starts past the flip, and counting it would report a card that was already on screen as an instant one.

Two counters accompany the spans: `memoryWarningCount` and `backgroundedCount`.

## Reading the report

In a development build, call `logReport()` from the performance context; the report prints to the Metro console as JSON, with each span's count, median, worst, budget, and an `overBudget` flag.

```
[fortuneness performance] {
  "backgroundedCount": 3,
  "memoryWarningCount": 0,
  "spans": [
    { "span": "startup.firstScreenReady", "count": 1, "medianMs": 2180, "worstMs": 2180,
      "budgetMs": 2500, "overBudget": false }
  ]
}
```

The release build carries the recorder but never prints. Profiling happens on a development or an internal build.

## Device matrix

| Device                   | Role             | Why                                                            |
| ------------------------ | ---------------- | -------------------------------------------------------------- |
| Oldest supported iPhone  | **Primary gate** | Every budget above is defined against it                       |
| iPad mini                | Secondary        | Regular layout with the smallest regular-width memory budget   |
| A current iPhone Pro Max | Reference        | Confirms a regression is device-specific rather than universal |

Run each scenario three times and take the median. A single cold launch is dominated by whatever the OS happened to be doing.

## Scenarios

### 1. Cold startup

1. Force-quit the app and leave the device idle for 30 seconds.
2. Launch. Record `startup.moduleLoaded` and `startup.firstScreenReady`.
3. Repeat three times.
4. Also record with Xcode Instruments (App Launch template) to attribute the time between process start and module evaluation, which JavaScript cannot see.

Pass: median `startup.firstScreenReady` within budget, and no launch above 4 seconds.

### 2. Card reveal

1. From a fresh Oracle with a draw available, request a reading.
2. Record `reveal.cardReady` and `reveal.contentReachable`.
3. Repeat with Reduce Motion on, which must not make either span _longer_.
4. Watch for dropped frames during the flip with the Animation Hitches template.

Pass: both spans within budget, no hitch above 100 ms during the flip, VoiceOver reaches the content in the documented order.

### 3. Collection scroll

1. Seed a 10,000-reading fixture (Phase 14 lists the same fixture).
2. Open Collection, record `collection.firstPageReady`.
3. Scroll continuously through at least twenty pages, recording `collection.pageAppended`.
4. Switch between deck and readings modes five times.
5. Apply and clear every filter combination once.

Pass: both spans within budget, sustained scrolling holds 60 fps on the primary device with no blank cells persisting longer than one frame, and memory does not grow monotonically across the twenty pages.

### 4. Memory pressure

1. With Collection scrolled deep and a reveal in progress, use Instruments to apply simulated memory pressure.
2. Record `memoryWarningCount` and confirm the app does not terminate.
3. Return to the app and confirm the pending reveal resumes at its persisted step, and the archive re-reads from SQLite rather than showing an empty state.

Pass: no termination, no lost pending reveal, no blank unrecoverable screen. This overlaps the Phase 14 zero-tolerance criteria and any failure here is release-blocking there.

### 5. Background and foreground transitions

1. Background the app mid-flip, mid-draw request, and mid-purchase.
2. Wait 10 seconds, 2 minutes, and 15 minutes before returning.
3. Record `foreground.resumed` for each.
4. Confirm the reveal resumes correctly, the session refreshes without a visible auth prompt, and no duplicate draw or purchase is issued.

Pass: `foreground.resumed` within budget for the 10-second and 2-minute cases; the 15-minute case may exceed the budget if the OS evicted the process, in which case the cold-startup budget applies instead. No duplicate draw, no duplicate delivery, no lost reveal.

## Bundle and asset budgets

`npm run asset:budget` already gates the shipped payload offline. During device profiling, additionally confirm:

- Installed app size on the primary device.
- Peak memory while scrolling the full 78-card deck with art.
- Peak memory during a reveal with the largest illustration.

Record these numbers even though they have no automated gate; Phase 11 owns the bundle-size acceptance and needs them.

## Rows a person must close

| #   | Row                                                                           | Status  |
| --- | ----------------------------------------------------------------------------- | ------- |
| 1   | Oldest supported device chosen and recorded                                   | NOT RUN |
| 2   | Cold startup profiled, three runs, median within budget                       | NOT RUN |
| 3   | Card reveal profiled with and without Reduce Motion                           | NOT RUN |
| 4   | Collection scroll profiled against the 10,000-reading fixture                 | NOT RUN |
| 5   | Memory pressure applied without termination or lost state                     | NOT RUN |
| 6   | Background and foreground transitions profiled at three durations             | NOT RUN |
| 7   | Installed size and peak memory recorded                                       | NOT RUN |
| 8   | Any span over budget has an owner and a fix, or a recorded accepted deviation | NOT RUN |
