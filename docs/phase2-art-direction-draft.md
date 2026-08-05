# Phase 2 art direction draft

Status: **DRAFT — UNLOCKED**

Full-deck prompt version: `full-deck-nocturnal-celestial-v1-unreviewed`

Seed proof prompt version: `phase2-nocturnal-celestial-v1-draft`

Proof set: The Fool, Queen of Cups, Three of Wands

Generated source manifest: `tools/card-assets/manifest.json`

Exact full-deck prompt catalog: `tools/card-assets/prompts/full-deck-v1.json`

This direction may be locked only after all three proofs pass coded-frame review on iPhone and iPad.

Production exception: on 2026-08-05, the product owner explicitly authorized generating the remaining 75 cards before Expo device review. This accelerates production at the accepted risk that some or all unreviewed sources may require regeneration after the style decision. Generation does not lock the direction or promote any asset beyond `GENERATED_UNREVIEWED`.

## Visual constants

- Original nocturnal Art Nouveau and celestial illustration language; never imitate a named artist.
- Midnight indigo and near-black violet foundation, with deep teal and muted amethyst fields.
- Restrained antique gold, moon silver, and parchment highlights rather than bright yellow or white glare.
- Clear central subject, readable silhouette, generous crop margins, and details that survive compact card size.
- Flowing botanical lines, constellations, crescent/star geometry, luminous water or sky where appropriate.
- Inclusive, dignified human representation without sexualized, graphic, frightening, or stereotyped treatment.
- Illustration layer only: no title, number, letter, word, logo, watermark, signature, or finished card border.

## Controlled variation

The deck should vary subject, pose, camera distance, horizon, environment, suit material, and celestial emphasis while retaining shared line weight, palette, lighting softness, density, and spatial clarity. Repeated compositions, identical faces, mirrored poses, or a single decorative frame pasted across cards are rejection conditions.

## Composition targets

| Attribute       | Draft target                                                                             |
| --------------- | ---------------------------------------------------------------------------------------- |
| Source ratio    | Approximately 2:3 portrait; current proofs are 848 × 1264 and inside validator tolerance |
| Shipping target | Approximately 1024 × 1536 after device-informed normalization                            |
| Subject         | One immediately readable focal subject or symbolic grouping                              |
| Safe area       | Essential faces, hands, suit objects, and card-defining counts stay away from crop edges |
| Background      | Supports depth and symbolism without overwhelming the subject or code-rendered frame     |
| Contrast        | Subject remains distinguishable at compact size in the dark UI                           |
| Text boundary   | All semantic labels remain code-rendered outside the generated illustration              |

## Proof observations to validate on device

| Proof          | Strengths seen in source inspection                                              | Open questions                                                                                      |
| -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The Fool       | Clear traveler/dog silhouette, luminous dawn star, rich botanical depth          | Does the dense lower foliage remain legible without visual noise at compact size?                   |
| Queen of Cups  | Dignified inclusive figure, readable ceremonial cup, strong symmetry and palette | Does the internal decorative line read as an unwanted generated card border inside the coded frame? |
| Three of Wands | Exactly three staffs, visible horizon/ships, clear outward-looking pose          | Are the fine constellations and distant ships readable enough on compact iPhone cards?              |

## Rejection checklist

Reject or regenerate a proof if any reviewer finds:

- readable or pseudo-readable text, signature, watermark, number, or logo;
- unsafe crop, obscured face/hands, incorrect card-defining object count, or ambiguous central subject;
- finished generated card frame competing with the code-rendered frame;
- substantially duplicated composition or checksum/perceptual duplicate;
- palette, line quality, lighting, or density inconsistent with the accepted set;
- stereotyped, sexualized, frightening, graphic, or age-inappropriate representation;
- poor small-size contrast or details that collapse into visual noise;
- symbolism presented in a way that conflicts with the editorial safety direction.

## Style-lock record

| Decision | Owner      | Commit/build | Devices reviewed | Date | Notes                                                               |
| -------- | ---------- | ------------ | ---------------- | ---- | ------------------------------------------------------------------- |
| UNLOCKED | Unassigned | —            | None             | —    | Awaiting all Phase 2 visual/accessibility rows and human art review |

When approved, create a new immutable prompt version rather than renaming this draft, record normalized output rules, and update every manifest entry without changing historical source checksums.
