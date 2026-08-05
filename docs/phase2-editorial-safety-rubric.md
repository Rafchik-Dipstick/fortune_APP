# Phase 2 editorial and safety rubric

Status: **READY FOR HUMAN REVIEW — NOT APPROVED**

Applies to: 24 English development templates, three illustration descriptions, three English alternative texts

Canonical data: `packages/fortune-content/src/development-slice.ts`

Automated rules: `packages/fortune-content/src/schema.ts`

## Review rule

Automated validation establishes structure and catches known prohibited patterns; it cannot approve tone, cultural sensitivity, interpretive fit, imagery accuracy, or safety in context. A named human editorial owner must review every template and description. Silence, generated status, and passing tests do not count as approval.

## Template acceptance checklist

Each card × orientation × intention template must pass every row.

| Dimension                | Pass standard                                                                                                          | Reject when                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Card fit                 | The reflection is recognizably grounded in the selected card without presenting symbolism as objective fact            | Copy is generic enough for any card or contradicts the card’s intended range                                  |
| Orientation fit          | Upright copy expresses available/outward/direct energy; reversed copy may be blocked, inward, delayed, or reconsidered | Reversed means punishment, doom, moral failure, danger, or an objectively negative future                     |
| Intention fit            | General, Love, Work, or Growth meaningfully changes the reflection                                                     | The intention is only named or superficially substituted                                                      |
| Possibility language     | Uses invitations such as “may,” “consider,” “notice,” or “could” and leaves agency with the reader                     | Predicts certainty, guarantees an outcome, or treats the reading as evidence                                  |
| Consequence safety       | Avoids commands about health, safety, law, money, employment, housing, relationships, or mental-health treatment       | Directs medication/treatment changes, unsafe departure, spending/investing, or another consequential decision |
| Interpersonal boundaries | Speaks to the reader’s observations, needs, questions, and choices                                                     | Claims another person’s hidden thoughts, feelings, fidelity, intentions, or future actions                    |
| Emotional safety         | Calm, non-shaming, non-alarmist, and suitable for a broad audience                                                     | Uses fear, urgency, coercion, blame, punishment, inevitability, or catastrophic framing                       |
| Headline                 | Distinct, useful, sentence-case phrase of 3–12 words                                                                   | Sensational, deterministic, repetitive, or disconnected from the message                                      |
| Message                  | 50–100 words with one coherent reflective arc and no filler                                                            | Below/above bounds, internally contradictory, repetitive, or vague                                            |
| Gentle action            | 10–25 words, bounded, low-stakes, reversible, and realistically actionable                                             | Commands a consequential action or implies the action controls an outcome                                     |
| Affirmation              | 3–16 words, first-person where natural, grounded, and non-grandiose                                                    | Promises control, certainty, exceptional power, or emotional suppression                                      |
| Distinctness             | Does not duplicate or closely paraphrase another template’s full reading                                               | Only card/intention nouns differ or the emotional/action pattern repeats mechanically                         |
| English quality          | Natural grammar, punctuation, rhythm, and inclusive vocabulary                                                         | Awkward generated phrasing, ambiguous referents, jargon, stereotypes, or inaccessible idiom                   |

## Illustration-description and alt-text checklist

Every description and final alternative text must:

- contain 8–25 English words for the runtime alt text;
- describe only visible subjects, setting, pose, objects, color/light where useful, and spatial relationships;
- name the card only through the separate code-rendered label, not by repeating the fortune;
- avoid divination claims, emotional diagnosis, symbolism-as-fact, aesthetic praise, and interpretation;
- identify meaningful human representation respectfully and without guessing identity attributes not visible or established;
- match the final cropped illustration, including counts that matter to the card such as three staffs;
- remain useful when announced after card name, orientation, and intention.

## Automated rejection categories

The current validator rejects:

- unsupported locale or invalid card reference;
- missing card/orientation/intention combinations;
- duplicate card keys, asset keys, logical template keys, or normalized full copy;
- messages outside 50–100 words, actions outside 10–25 words, and alt text outside 8–25 words;
- guaranteed/absolute outcomes and hidden-thought claims;
- medication/treatment, financial transaction, unsafe-action, punitive, or doom language.

Human review must still catch paraphrases and contextual harm not covered by these patterns. New recurring failure language should produce a validator regression test before approval.

## Review procedure

1. Run `corepack npm run content:validate` against the exact commit under review.
2. Review all eight templates for one card together to test orientation and intention distinction.
3. Review all three cards for one intention together to detect formulaic repetition.
4. Compare illustration description and alt text to the final image inside the coded frame.
5. Record requested edits against stable keys: `cardKey:orientation:intention:variant`.
6. Rerun automated validation and complete a second-person editorial pass after edits.
7. Change `editorialStatus` to `APPROVED` only with named owner, date, commit, and decision evidence in `DEPLOY_BOOK.md`.

## Approval record

| Scope                           | Reviewer   | Review commit | Decision date | Decision         | Notes/evidence              |
| ------------------------------- | ---------- | ------------- | ------------- | ---------------- | --------------------------- |
| The Fool — 8 templates          | Unassigned | —             | —             | READY FOR REVIEW | —                           |
| Queen of Cups — 8 templates     | Unassigned | —             | —             | READY FOR REVIEW | —                           |
| Three of Wands — 8 templates    | Unassigned | —             | —             | READY FOR REVIEW | —                           |
| Three illustration descriptions | Unassigned | —             | —             | READY FOR REVIEW | —                           |
| Three final alternative texts   | Unassigned | —             | —             | READY FOR REVIEW | Must compare to coded crops |

Phase 2 editorial acceptance remains open until every row has a named approval or a documented revision followed by approval.
