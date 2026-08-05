# Phase 2 visual acceptance matrix

Status: **OPEN**

Owner: product/design and iOS QA owner to be assigned

Implementation baseline: commit `5fc471e` or later

Specification gate: Phase 2 — Design system and adaptive vertical slice

This record prevents local JavaScript checks from being mistaken for iPhone/iPad, accessibility, art, or editorial approval. A row is complete only when its evidence fields name the build, device, operating system, tester, date, and result.

## Automated evidence already available

| Evidence                                                    | Current result                     | Command or source                                        |
| ----------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| 320/599/600/899/900/1024-point layout classifications       | Pass                               | `apps/mobile/src/theme/adaptive.test.ts`                 |
| Default reveal duration remains 600–750 ms                  | Pass at 675 ms                     | `apps/mobile/src/motion/reveal-motion.test.ts`           |
| Reduce Motion reveal remains 150–250 ms with no perspective | Pass at 200 ms                     | `apps/mobile/src/motion/reveal-motion.test.ts`           |
| Strict checks, 18 tests, content and asset validation       | Pass                               | `corepack npm run check`                                 |
| Expo dependency/configuration health                        | Pass, 20/20                        | `cd apps/mobile && corepack npm exec expo-doctor@latest` |
| iOS JavaScript export including local art                   | Pass                               | `corepack npm run build --workspace @fortuneness/mobile` |
| Three-card content matrix                                   | Pass, 24/24 ready for review       | `corepack npm run content:validate`                      |
| ADC art manifest                                            | Complete proof set, 3/3 unreviewed | `corepack npm run asset:validate`                        |
| Brand mark manifest                                         | Pass, one unreviewed square proof  | `corepack npm run brand:validate`                        |

Automated evidence does not close any physical-device row below.

## Required presentation matrix

Run every page/state in English and the debug-only length-expanded pseudo-locale. Essential content must remain readable without horizontal scrolling, clipping, overlap, unsafe-area intrusion, or fixed-height truncation.

| ID     | Width/device class           | Orientation/window              | Required states                                                          | Status  |
| ------ | ---------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ------- |
| P2-V01 | 320 pt compact-width fixture | Portrait                        | Oracle ready/loading/error; Reveal; Collection; Shop and sheet; Settings | NOT RUN |
| P2-V02 | Small supported iPhone       | Portrait and landscape          | Same states; sensor housing and home-indicator safe areas                | NOT RUN |
| P2-V03 | Large modern iPhone          | Portrait and landscape          | Same states; capped card width and readable line lengths                 | NOT RUN |
| P2-V04 | iPad                         | Portrait                        | Same states; regular two-column Oracle and centered sheet                | NOT RUN |
| P2-V05 | iPad                         | Landscape                       | Same states; no excessive stretch or unsafe edges                        | NOT RUN |
| P2-V06 | iPad Split View              | Compact and intermediate widths | Live reflow across 600/900-point boundaries; sheet fallback              | NOT RUN |
| P2-V07 | iPad Stage Manager           | Resizable window                | Repeated resizing without stale columns, overlap, or lost controls       | NOT RUN |

## Accessibility and motion matrix

| ID     | Configuration                        | Required observation                                                                                                                     | Status  |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P2-A01 | Largest supported Dynamic Type sizes | Essential copy wraps and every page scrolls; no control or card label truncates                                                          | NOT RUN |
| P2-A02 | VoiceOver                            | Logical order; names, roles, values, selected intentions, card name/orientation/intention/visible imagery, and retry state are announced | NOT RUN |
| P2-A03 | VoiceOver during reveal              | Face-down result stays undisclosed; final headline, message, action, and affirmation become reachable before acknowledgement             | NOT RUN |
| P2-A04 | Reduce Motion off                    | Quiet 675 ms perspective flip followed by text reveal; interaction remains responsive                                                    | NOT RUN |
| P2-A05 | Reduce Motion on                     | 200 ms crossfade, no 3D/parallax, no delayed readable content, and no skeleton pulse                                                     | NOT RUN |
| P2-A06 | Reduce Transparency on               | Opaque surfaces and modal backdrop preserve content contrast; no meaning depends on transparency                                         | NOT RUN |
| P2-A07 | Switch Control or keyboard focus     | Visible focus indicator and all primary actions reachable with at least 44 × 44 pt targets                                               | NOT RUN |
| P2-A08 | Grayscale/high-contrast inspection   | State is not communicated by color alone; text/control contrast remains acceptable                                                       | NOT RUN |

## Art and editorial matrix

No item can be marked approved by automated generation or by the coding agent.

Review against `docs/phase2-editorial-safety-rubric.md` and `docs/phase2-art-direction-draft.md`; exact generated prompts are checksum-bound through the card and brand manifests.

| Item                                    | Mechanical status                                                        | Required human decision                                                   | Status           |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------- |
| The Fool illustration                   | Generated, manifested, checksum-valid, visually inspected in source form | Review coded frame at compact/regular sizes; approve imagery and alt text | READY FOR REVIEW |
| Queen of Cups illustration              | Generated, manifested, checksum-valid, visually inspected in source form | Review coded frame at compact/regular sizes; approve imagery and alt text | READY FOR REVIEW |
| Three of Wands illustration             | Generated, manifested, checksum-valid, visually inspected in source form | Review coded frame at compact/regular sizes; approve imagery and alt text | READY FOR REVIEW |
| 24 English fortune templates            | Complete and validator-clean                                             | Editorial safety, tone, grammar, distinctness, and card/intention fit     | READY FOR REVIEW |
| Three English illustration descriptions | Complete and validator-clean                                             | Editorial visible-imagery accuracy and 8–25-word final alt text           | READY FOR REVIEW |
| Draft art prompt/style                  | Three proofs available                                                   | Lock only after all three cards pass iPhone and iPad coded-frame review   | UNLOCKED         |
| Fortuneness app-icon/launch mark        | 1024 × 1024 RGB proof generated, manifested, and configured              | Review small sizes, iOS masks, launch presentation, and brand fit         | READY FOR REVIEW |

## Per-run evidence template

Copy this block for each completed matrix row. Store screenshots outside source control unless the QA owner explicitly chooses a reviewed evidence directory.

```text
Matrix ID:
Result: PASS | FAIL | BLOCKED
Commit/build ID:
EAS build URL or artifact checksum:
Device model:
OS version:
Viewport/window dimensions:
Orientation:
Locale:
Dynamic Type size:
VoiceOver:
Reduce Motion:
Reduce Transparency:
Tester:
Date/time zone:
Screenshot/video references:
Observed issues and linked fixes:
Retest evidence:
```

## Phase 2 exit decision

Phase 2 remains **OPEN** until all of the following are true:

- All three ADC illustrations exist, validate, and pass coded-frame review on iPhone and iPad.
- All 24 templates, three illustration descriptions, and final alternative texts have named human approval.
- Every presentation and accessibility row above has passing evidence against one signed development-build baseline.
- The art prompt/style manifest is locked only after that evidence exists.
- Any failure is fixed, recorded in `DEPLOY_BOOK.md`, and retested before Phase 3 begins.
