# Phase 7: NPC Driving AI & Circuit Racers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-22
**Phase:** 7-NPC Driving AI & Circuit Racers
**Areas discussed:** Field & start, What placing means, AI pace & temperament, Stuck cars & readability

---

## Todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| Shorter Juliette course | Author a tighter circuit | ✓ (initially) |
| Drivetrain per car class | RWD/FWD/AWD support | ✓ (initially) |

**User's choice:** Both, plus note: "at some point we need to discuss different maps - would like a city, and some small areas with short tracks. Juliette is ok but it's very big and quite sparse"
**Notes:** On follow-up, both were returned to deferred: the short course → "Leave it for the maps discussion"; drivetrain → "Keep it deferred" (AI use the player's exact car).

---

## Field & start

| Question | Options | Selected |
|----------|---------|----------|
| Field size | 3 (4-car race) / 5 (6-car race) / 1 rival | 3 (4-car race) |
| AI cars | Same car recolored / Different car classes / Same tune different bodies | Same car, recolored |
| Start | Grid + 3-2-1 countdown / Rolling-first-move start / You decide | You decide → grid + countdown for Circuit Race only |
| Grid slot | Back of the grid / Pole / Random | Back of the grid |

---

## What placing means

| Question | Options | Selected |
|----------|---------|----------|
| Medals vs AI | Separate modes / Same medals AI always present / Medals ignore AI | Separate modes |
| Placing | Shown + saved best finish / Shown only / Win required | Shown + saved as best finish |
| Finish | Freeze & project / Let them finish | Other: "let them finish but with option to interrupt and retry (quickly projects placement of remaining cars)" |
| Resets | Respawn: AI continue, restart: full reset / Both reset everyone | Respawn: AI keep going; restart: full reset |

---

## AI pace & temperament

| Question | Options | Selected |
|----------|---------|----------|
| Pace | ~Silver / ~Gold / Spread across field | Around Silver pace |
| Temperament | Race line + mild avoidance / Aggressive-defend / Oblivious | Race their line, mild avoidance |
| Line | Smoothed racing line on road / Lane-centred / Line with gravel shortcuts | Smoothed racing line on the road |
| Style | Tidy grip, natural slides / Deliberate drifting | Tidy grip driving |

---

## Stuck cars & readability

| Question | Options | Selected |
|----------|---------|----------|
| Recovery | Drive out then reset / Immediate reset / Despawn | Try to drive out, then reset |
| Minimap | Colored dots + edge blips / No edge blips / No | Colored dots matching paint |
| Debug overlay (multi) | Racing line / Look-ahead target / State label / Stuck timers | All four |
| Race HUD | Position + lap / Position + gap to car ahead / You decide | Position + gap to car ahead |

---

## Claude's Discretion

- Start sequence (user said "you decide"): grid + countdown for Circuit Race; solo Time Attack unchanged.
- Course-data representation of Circuit Race, AI controller algorithm, stuck thresholds, paint colors, gap computation.

## Deferred Ideas

- New maps: city map + small areas with short tracks.
- Shorter Juliette course todo → maps discussion.
- Drivetrain-per-car-class todo → future car-classes phase.
